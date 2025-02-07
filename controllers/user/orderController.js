const Product = require("../../models/productSchema");
const Category = require("../../models/categorySchema");
const Cart = require('../../models/cartSchema');
const Address = require('../../models/addressSchema');
const Order = require('../../models/orderSchema');
const User = require("../../models/userSchema");
const Wallet = require('../../models/walletSchema');
const mongoose = require('mongoose');

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
                message: 'Order not found',
                title: 'Error'
            });
        }

        // Create helper functions for item status checks
        const itemHelpers = {
            canBeCancelled: (item) => {
                const nonCancellableStatuses = ['shipped', 'delivered', 'cancelled', 'returned'];
                return item.status === 'active' && !nonCancellableStatuses.includes(order.orderStatus);
            },
            canBeReturned: (item) => {
                // Check basic conditions first
                if (item.status !== 'active') return false;
                if (order.orderStatus !== 'delivered') return false;
        
                // Find the delivery entry from status history
                const deliveryEntry = order.statusHistory
                    .filter(status => status.status === 'delivered')
                    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))[0];
        
                if (!deliveryEntry) return false;
        
                // Calculate days since delivery
                const deliveryDate = new Date(deliveryEntry.timestamp);
                const currentDate = new Date();
                const daysSinceDelivery = Math.floor((currentDate - deliveryDate) / (1000 * 60 * 60 * 24));
        
                // Return true if within 7-day window
                return daysSinceDelivery <= 7;
            },
            getRemainingReturnDays: (item) => {
                // Find the delivery entry
                const deliveryEntry = order.statusHistory
                    .filter(status => status.status === 'delivered')
                    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))[0];
        
                if (!deliveryEntry) return 0;
        
                const deliveryDate = new Date(deliveryEntry.timestamp);
                const currentDate = new Date();
                const daysSinceDelivery = Math.floor((currentDate - deliveryDate) / (1000 * 60 * 60 * 24));
                
                return Math.max(0, 7 - daysSinceDelivery);
            },
            isDelivered: (order) => {
                return order.orderStatus === 'delivered';
            },
            getDeliveryDate: (order) => {
                const deliveryEntry = order.statusHistory
                    .filter(status => status.status === 'delivered')
                    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))[0];
                
                return deliveryEntry ? new Date(deliveryEntry.timestamp) : null;
            },
            formatCurrency: (amount) => {
                return amount ? amount.toFixed(2) : '0.00';
            }
        };

        // Process coupon information safely
        let couponInfo = null;
        if (order.coupon && order.coupon.code) {
            const discountAmount = order.coupon.discountAmount || 0;
            couponInfo = {
                code: order.coupon.code,
                discountAmount: discountAmount,
                discountType: order.coupon.discountType || 'fixed',
                formattedDiscount: `₹${discountAmount.toFixed(2)}${
                    order.coupon.discountType === 'percentage' ? ` (${discountAmount}%)` : ''
                }`
            };
        }

        res.render('orderViewDetails', {
            order,
            user: req.user,
            itemHelpers,
            couponInfo,
            title: `Order #${order.orderNumber}`
        });

    } catch (error) {
        console.error('Error fetching order details:', error);
        res.status(500).render('error', {
            message: 'Error fetching order details',
            error: process.env.NODE_ENV === 'development' ? error : {}
        });
    }
};

// Helper function to calculate remaining return days
const calculateReturnDays = (deliveryDate) => {
    if (!deliveryDate) return 0;
    const timeDiff = Date.now() - new Date(deliveryDate).getTime();
    const daysDiff = Math.floor(timeDiff / (1000 * 60 * 60 * 24));
    return Math.max(0, 7 - daysDiff);
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
        const userId = req.user._id;
        const { orderId, itemId } = req.params;
        const { reason, condition, comments } = req.body;

        console.log("Processing return request:", { orderId, itemId, userId });

        // Input validation
        if (!reason || !condition) {
            return res.status(400).json({
                success: false,
                message: 'Return reason and condition are required'
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
                message: 'Item not found in order'
            });
        }

        console.log("Current item status:", orderItem.status);

        // Validate return eligibility
        if (orderItem.status !== 'active') {
            return res.status(400).json({
                success: false,
                message: 'Item is not in an active state'
            });
        }

        if (order.orderStatus !== 'delivered') {
            return res.status(400).json({
                success: false,
                message: 'Order must be delivered to process return'
            });
        }


        // Calculate refund amount
        const refundAmount = orderItem.calculateRefundAmount();

        // Update item status and return details
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

        // Handle wallet refund if payment was completed
        if (order.paymentStatus === 'completed' && 
            ['razorpay', 'wallet'].includes(order.paymentMethod)) {
            
            let wallet = await Wallet.findOne({ user: userId });
            if (!wallet) {
                wallet = new Wallet({
                    user: userId,
                    balance: 0
                });
                await wallet.save();
            }

            const walletTransaction = await wallet.credit(
                refundAmount,
                'Refund for returned order item',
                {
                    reason: 'order_return',
                    orderId: order._id,
                    itemId: itemId,
                    originalOrderNumber: order.orderNumber
                }
            );

            orderItem.returnDetails.refundStatus = 'completed';
            orderItem.returnDetails.walletTransactionId = walletTransaction._id;
            orderItem.returnDetails.processedAt = new Date();
        }

        // Update product inventory
        if (orderItem.product) {
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

        // Add to status history
        order.statusHistory.push({
            status: 'partially_returned',
            timestamp: new Date(),
            comment: `Return requested: ${reason}`
        });

        // Update order status
        order.updateOrderStatus();
        
        // Save the order
        await order.save();

        console.log("Return process completed successfully");

        return res.status(200).json({
            success: true,
            message: 'Return request submitted successfully',
            details: {
                orderStatus: order.orderStatus,
                itemStatus: orderItem.status,
                refundAmount,
                refundStatus: orderItem.returnDetails.refundStatus
            }
        });

    } catch (error) {
        console.error('Return processing error:', error);
        return res.status(500).json({
            success: false,
            message: error.message || 'Error processing return request'
        });
    }
};


module.exports = {
    getUserOrders,
    getOrderDetails,
    cancelOrderItem,
    returnOrderItem
}