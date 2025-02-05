const Product = require("../../models/productSchema");
const Category = require("../../models/categorySchema");
const Cart = require('../../models/cartSchema');
const Address = require('../../models/addressSchema');
const Order = require('../../models/orderSchema');
const User = require("../../models/userSchema");
const Wallet = require('../../models/walletSchema');

const getUserOrders = async (req, res) => {
    try {
        const userId = req.user._id;
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 5;
        const skip = (page - 1) * limit;

        // Fetch orders with pagination
        const orders = await Order.find({ user: userId })
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .populate('items.product');

        // Get total orders count for pagination
        const totalOrders = await Order.countDocuments({ user: userId });
        const totalPages = Math.ceil(totalOrders / limit);

        // Create helper functions for formatting
        const orderHelpers = {
            getStatusClass: (status) => {
                const statusMap = {
                    'pending': 'status-pending',
                    'confirmed': 'status-confirmed',
                    'processing': 'status-confirmed',
                    'shipped': 'status-confirmed',
                    'delivered': 'status-delivered',
                    'cancelled': 'status-cancelled',
                    'returned': 'status-cancelled',
                    'partially_cancelled': 'status-cancelled',
                    'partially_returned': 'status-cancelled'
                };
                return statusMap[status] || 'status-pending';
            },
            formatDate: (date) => {
                return new Date(date).toLocaleDateString('en-US', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric'
                });
            },
            formatCurrency: (amount) => {
                return amount.toFixed(2);
            }
        };

        // Render orders page
        res.render('order', {
            orders,
            currentPage: page,
            totalPages,
            totalOrders,
            orderHelpers,
            user: req.user
        });
    } catch (error) {
        console.error('Error fetching orders:', error);
        res.status(500).render('error', {
            message: 'Error fetching orders',
            error: process.env.NODE_ENV === 'development' ? error : {}
        });
    }
};

const getOrderDetails = async (req, res) => {
    try {
        const orderId = req.params.orderId;
        const userId = req.user._id;

        // Fetch order with populated product details
        const order = await Order.findOne({
            orderId: orderId,
            user: userId
        }).populate('items.product');

        if (!order) {
            return res.status(404).render('error', {
                message: 'Order not found'
            });
        }

        // Create helper functions for item status checks
        const itemHelpers = {
            canBeCancelled: (item) => {
                const nonCancellableStatuses = ['shipped', 'delivered', 'cancelled', 'returned'];
                return item.status === 'active' && !nonCancellableStatuses.includes(order.orderStatus);
            },
            canBeReturned: (item) => {
                if (item.status !== 'active' || order.orderStatus !== 'delivered') return false;
                
                const deliveredDate = order.statusHistory.find(h => h.status === 'delivered')?.timestamp;
                if (!deliveredDate) return false;
                
                const returnWindow = 7 * 24 * 60 * 60 * 1000; // 7 days in milliseconds
                return (Date.now() - deliveredDate.getTime()) <= returnWindow;
            }
        };

        // Render order details page
        res.render('orderViewDetails', {
            order,
            user: req.user,
            itemHelpers
        });
    } catch (error) {
        console.error('Error fetching order details:', error);
        res.status(500).render('error', {
            message: 'Error fetching order details',
            error: process.env.NODE_ENV === 'development' ? error : {}
        });
    }
};

const cancelOrderItem = async (req, res) => {
    try {
        const { orderId, itemId } = req.params;
        const userId = req.user._id;
        const { reason } = req.body;

        // Validate reason
        if (!reason || reason.trim().length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Cancellation reason is required'
            });
        }

        // Find the order
        const order = await Order.findOne({
            orderId: orderId,
            user: userId
        });

        if (!order) {
            return res.status(404).json({
                success: false,
                message: 'Order not found'
            });
        }

        // Find the specific item
        const orderItem = order.items.id(itemId);
        if (!orderItem) {
            return res.status(404).json({
                success: false,
                message: 'Item not found'
            });
        }

        // Check if item can be cancelled
        const nonCancellableStatuses = ['shipped', 'delivered', 'cancelled', 'returned'];
        if (orderItem.status !== 'active' || nonCancellableStatuses.includes(order.orderStatus)) {
            return res.status(400).json({
                success: false,
                message: 'This item cannot be cancelled'
            });
        }

        // Calculate refund amount
        const refundAmount = orderItem.calculateRefundAmount();

        // Update item status
        orderItem.status = 'cancelled';
        orderItem.cancellationDetails = {
            cancelledAt: new Date(),
            reason: reason,
            refundAmount,
            refundStatus: order.paymentStatus === 'completed' ? 'pending' : 'not_applicable'
        };

        // Handle refund for online/wallet payments
        if (order.paymentStatus === 'completed' && 
            (order.paymentMethod === 'razorpay' || order.paymentMethod === 'wallet')) {
            try {
                // Find or create wallet
                let wallet = await Wallet.findOne({ user: userId });
                if (!wallet) {
                    wallet = new Wallet({
                        user: userId,
                        balance: 0
                    });
                }

                // Add refund to wallet
                const walletTransaction = await wallet.credit(
                    refundAmount,
                    `Refund for cancelled order #${order.orderNumber}`,
                    {
                        reason: 'order_cancellation',
                        orderId: order._id,
                        itemId: itemId,
                        refundDetails: {
                            originalOrderId: order._id,
                            reason: reason
                        }
                    }
                );

                // Update cancellation details
                orderItem.cancellationDetails.refundStatus = 'completed';
                orderItem.cancellationDetails.walletTransactionId = walletTransaction._id;
                orderItem.cancellationDetails.processedAt = new Date();

            } catch (walletError) {
                console.error('Wallet refund error:', walletError);
                orderItem.cancellationDetails.refundStatus = 'failed';
            }
        }

        // Update product stock
        if (orderItem.product) {
            const product = await Product.findById(orderItem.product);
            if (product) {
                const variant = product.variants.find(v => 
                    v.colorName === orderItem.selectedColor.colorName);
                if (variant) {
                    const sizeVariant = variant.colorVariant.find(sv => 
                        sv.size === orderItem.selectedSize);
                    if (sizeVariant) {
                        // Update stock
                        sizeVariant.stock += orderItem.quantity;
                        // Use findByIdAndUpdate to avoid validation
                        await Product.findByIdAndUpdate(
                            product._id,
                            { $set: { variants: product.variants } },
                            { new: true, runValidators: false }
                        );
                    }
                }
            }
        }

        // Add to status history
        order.statusHistory.push({
            status: 'partially_cancelled',
            timestamp: new Date(),
            comment: `Item cancelled: ${reason}`
        });

        // Update order status
        order.updateOrderStatus();
        await order.save();

        return res.status(200).json({
            success: true,
            message: 'Item cancelled successfully and refund has been added to your wallet'
        });

    } catch (error) {
        console.error('Error cancelling order item:', error);
        return res.status(500).json({
            success: false,
            message: error.message || 'Error cancelling item'
        });
    }
};

const returnOrderItem = async (req, res) => {
    try {
        const { orderId, itemId } = req.params;
        const userId = req.user._id;
        const { reason, condition, comments } = req.body;

        // Validate inputs
        if (!reason || !condition) {
            req.flash('error', 'Return reason and condition are required');
            return res.redirect(`/orders/${orderId}`);
        }

        const order = await Order.findOne({
            orderId: orderId,
            user: userId
        }).populate('items.product');

        if (!order) {
            req.flash('error', 'Order not found');
            return res.redirect('/orders');
        }

        // Find the specific item
        const orderItem = order.items.id(itemId);
        if (!orderItem) {
            req.flash('error', 'Item not found');
            return res.redirect(`/orders/${orderId}`);
        }

        // Check return eligibility
        if (orderItem.status !== 'active' || order.orderStatus !== 'delivered') {
            req.flash('error', 'Item is not eligible for return');
            return res.redirect(`/orders/${orderId}`);
        }

        const deliveredDate = order.statusHistory.find(h => h.status === 'delivered')?.timestamp;
        if (!deliveredDate || Date.now() - deliveredDate.getTime() > 7 * 24 * 60 * 60 * 1000) {
            req.flash('error', 'Return window has expired');
            return res.redirect(`/orders/${orderId}`);
        }

        // Calculate refund amount
        const refundAmount = orderItem.calculateRefundAmount();

        // Update item status
        orderItem.status = 'return_pending';
        orderItem.returnDetails = {
            requestedAt: new Date(),
            reason,
            condition,
            comments: comments || '',
            refundAmount,
            status: 'pending',
            refundStatus: 'pending'
        };

        // Handle refund for online payments
        if (order.paymentStatus === 'completed' && 
            (order.paymentMethod === 'razorpay' || order.paymentMethod === 'wallet')) {
            try {
                const wallet = await Wallet.findOne({ user: userId });
                if (!wallet) {
                    throw new Error('Wallet not found');
                }

                // Credit wallet
                const walletTransaction = await wallet.credit(refundAmount, 'Refund for returned order item', {
                    reason: 'order_return',
                    orderId: order._id,
                    itemId: itemId
                });

                orderItem.returnDetails.refundStatus = 'completed';
                orderItem.returnDetails.walletTransactionId = walletTransaction._id;
                orderItem.returnDetails.processedAt = new Date();
            } catch (walletError) {
                console.error('Wallet refund error:', walletError);
                orderItem.returnDetails.refundStatus = 'failed';
            }
        }

        // Update product stock on return approval
        if (orderItem.status === 'returned' && orderItem.product) {
            const product = await Product.findById(orderItem.product);
            if (product) {
                const variant = product.variants.find(v => 
                    v.colorName === orderItem.selectedColor.colorName);
                if (variant) {
                    const sizeVariant = variant.colorVariant.find(sv => 
                        sv.size === orderItem.selectedSize);
                    if (sizeVariant) {
                        sizeVariant.stock += orderItem.quantity;
                        await product.save();
                    }
                }
            }
        }

        // Update order status
        order.updateOrderStatus();
        await order.save();

        req.flash('success', 'Return request submitted successfully');
        res.redirect(`/orders/${orderId}`);

    } catch (error) {
        console.error('Error processing return:', error);
        req.flash('error', error.message || 'Error processing return request');
        res.redirect(`/orders/${req.params.orderId}`);
    }
};
module.exports = {
    getUserOrders,
    getOrderDetails,
    cancelOrderItem,
    returnOrderItem
}