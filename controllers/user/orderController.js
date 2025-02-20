const Product = require("../../models/productSchema");
const Category = require("../../models/categorySchema");
const Cart = require('../../models/cartSchema');
const Address = require('../../models/addressSchema');
const Order = require('../../models/orderSchema');
const User = require("../../models/userSchema");
const Wallet = require('../../models/walletSchema');
const mongoose = require('mongoose');
const Razorpay = require('razorpay');
const crypto = require('crypto');


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

        // Define status class mapping function
        const getStatusClass = (status) => {
            const statusMap = {
                'pending': 'status-pending',
                'confirmed': 'status-confirmed',
                'processing': 'status-confirmed',
                'shipped': 'status-confirmed',
                'delivered': 'status-delivered',
                'cancelled': 'status-cancelled',
                'returned': 'status-cancelled',
                'partially_cancelled': 'status-cancelled',
                'partially_returned': 'status-cancelled',
                'payment_failed': 'status-payment_failed',
                'failed': 'status-failed'
            };
            return statusMap[status] || 'status-pending';
        };

        // Render orders page
        res.render('order', {
            orders,
            currentPage: page,
            totalPages,
            totalOrders,
            getStatusClass, // Pass the function to the view
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
        const { orderId, itemId } = req.params;
        const userId = req.user._id;
        const { reason, condition, comments } = req.body;

        // Input validation
        if (!reason || !condition) {
            return res.status(400).json({
                success: false,
                message: 'Return reason and condition are required'
            });
        }

        // Find order
        const order = await Order.findOne({
            orderId: orderId,
            user: userId
        }).populate('items.product');

        if (!order) {
            return res.status(404).json({
                success: false,
                message: 'Order not found'
            });
        }

        // Find specific item
        const orderItem = order.items.id(itemId);
        if (!orderItem) {
            return res.status(404).json({
                success: false,
                message: 'Item not found in order'
            });
        }

        // Check return eligibility
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

        // Calculate refund amount (but don't process it yet)
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

        // Add to status history
        order.statusHistory.push({
            status: 'processing',  // Use a valid enum value
            timestamp: new Date(),
            comment: `Return requested for item: ${orderItem.productName}. Reason: ${reason}`
        });

        // Update order status if needed
        const activeItems = order.items.filter(item => item.status === 'active');
        const returnPendingItems = order.items.filter(item => item.status === 'return_pending');
        
        if (activeItems.length === 0 && returnPendingItems.length === order.items.length) {
            order.orderStatus = 'processing';  // Use a valid enum value
        } else if (returnPendingItems.length > 0) {
            order.orderStatus = 'processing';  // Use a valid enum value
        }

        // Save changes
        await order.save();

        return res.status(200).json({
            success: true,
            message: 'Return request submitted successfully',
            details: {
                orderNumber: order.orderNumber,
                itemName: orderItem.productName,
                returnId: orderItem.returnDetails._id,
                refundAmount,
                refundStatus: 'pending'
            }
        });

    } catch (error) {
        console.error('Return processing error:', error);
        return res.status(500).json({
            success: false,
            message: 'Error processing return request'
        });
    }
};

const retryPayment = async (req, res) => {
    try {
        const { orderId } = req.params;
        const { 
            razorpay_payment_id, 
            razorpay_order_id, 
            razorpay_signature 
        } = req.body;

        // Find the order
        const order = await Order.findOne({ orderId });
        if (!order) {
            throw new Error('Order not found');
        }

        // Verify signature
        const body = razorpay_order_id + '|' + razorpay_payment_id;
        const expectedSignature = crypto
            .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
            .update(body)
            .digest('hex');

        if (expectedSignature !== razorpay_signature) {
            throw new Error('Invalid payment signature');
        }

        // Update order with new payment details
        order.paymentStatus = 'completed';
        order.orderStatus = 'confirmed';
        order.paymentDetails = {
            razorpayOrderId: razorpay_order_id,
            razorpayPaymentId: razorpay_payment_id,
            razorpaySignature: razorpay_signature,
            paidAmount: order.finalAmount,
            paidAt: new Date()
        };

        // Add to status history
        order.statusHistory.push({
            status: 'confirmed',
            timestamp: new Date(),
            comment: 'Payment retry successful'
        });

        await order.save();

        res.status(200).json({
            success: true,
            message: 'Payment completed successfully'
        });

    } catch (error) {
        console.error('Payment retry error:', error);
        res.status(400).json({
            success: false,
            message: error.message || 'Payment retry failed'
        });
    }
};


const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET
});

// Create Razorpay order
const createRazorpayOrder = async (req, res) => {
    try {
        const { amount } = req.body;
        
        if (!amount || amount <= 0) {
            throw new Error('Invalid amount');
        }

        const options = {
            amount: Math.round(amount * 100), // amount in paisa
            currency: 'INR',
            receipt: 'order_' + Date.now(),
            notes: {
                userId: req.user._id.toString()
            }
        };

        const order = await razorpay.orders.create(options);
        
        res.status(200).json({
            success: true,
            orderId: order.id,
            amount: order.amount,
            key: process.env.RAZORPAY_KEY_ID
        });

    } catch (error) {
        console.error('Razorpay order creation error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to create payment order',
            error: error.message
        });
    }
};

// Verify Razorpay payment


const verifyRazorpayPayment = async (req, res) => {
    try {
        const { orderId } = req.params;
        const { 
            razorpay_payment_id, 
            razorpay_order_id, 
            razorpay_signature 
        } = req.body;

        // Find the order first
        const order = await Order.findOne({ orderId });
        if (!order) {
            throw new Error('Order not found');
        }

        // Verify signature
        const body = razorpay_order_id + '|' + razorpay_payment_id;
        const expectedSignature = crypto
            .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
            .update(body)
            .digest('hex');

        if (expectedSignature !== razorpay_signature) {
            throw new Error('Invalid payment signature');
        }

        // Update product quantities for each item in the order
        const productUpdatePromises = order.items.map(async (item) => {
            const product = await Product.findById(item.product);
            if (product) {
                const variant = product.variants.find(v => 
                    v.colorName === item.selectedColor.colorName
                );
                if (variant) {
                    const sizeVariant = variant.colorVariant.find(sv => 
                        sv.size === item.selectedSize
                    );
                    if (sizeVariant) {
                        // Decrease stock
                        sizeVariant.stock = Math.max(0, sizeVariant.stock - item.quantity);
                        
                        // Update product sales count
                        product.totalSales = (product.totalSales || 0) + item.quantity;

                        // Save the product
                        return Product.findByIdAndUpdate(
                            product._id,
                            { 
                                $set: { 
                                    variants: product.variants,
                                    totalSales: product.totalSales
                                }
                            },
                            { new: true, runValidators: false }
                        );
                    }
                }
            }
        });

        // Wait for all product updates
        await Promise.all(productUpdatePromises);

        // Remove ordered items from user's cart
        const cart = await Cart.findOne({ user: order.user });
        if (cart) {
            // Remove items that match the ordered items
            cart.items = cart.items.filter(cartItem => 
                !order.items.some(orderItem => 
                    orderItem.product.toString() === cartItem.product.toString() &&
                    orderItem.selectedColor.colorName === cartItem.selectedColor.colorName &&
                    orderItem.selectedSize === cartItem.selectedSize
                )
            );

            // Recalculate cart totals
            let totalAmount = 0;
            let totalDiscount = 0;
            
            cart.items.forEach(item => {
                const itemTotal = item.price * item.quantity;
                const productDiscount = (itemTotal * item.appliedProductOffer) / 100;
                const categoryDiscount = (itemTotal * item.appliedCategoryOffer) / 100;
                
                totalAmount += itemTotal;
                totalDiscount += (productDiscount + categoryDiscount);
            });
            
            cart.totalAmount = totalAmount;
            cart.totalDiscount = totalDiscount;

            await cart.save();
        }

        // Update order with new payment details
        order.paymentStatus = 'completed';
        order.orderStatus = 'confirmed';
        order.paymentDetails = {
            razorpayOrderId: razorpay_order_id,
            razorpayPaymentId: razorpay_payment_id,
            razorpaySignature: razorpay_signature,
            paidAmount: order.finalAmount,
            paidAt: new Date()
        };

        // Add to status history
        order.statusHistory.push({
            status: 'confirmed',
            timestamp: new Date(),
            comment: 'Payment completed successfully'
        });

        await order.save();

        res.status(200).json({
            success: true,
            message: 'Payment verified successfully'
        });

    } catch (error) {
        console.error('Payment verification error:', error);
        res.status(400).json({
            success: false,
            message: error.message || 'Payment verification failed'
        });
    }
};

const generateUserInvoice = async (req, res) => {
    try {
        const { orderId } = req.params;
        
        // Fetch order without lean() to keep virtuals
        const order = await Order.findOne({
            _id: orderId,
            user: req.user._id
        })
        .populate({
            path: 'items.product',
            select: 'productName variants category',
            populate: {
                path: 'category',
                select: 'name'
            }
        })
        .populate('user', 'firstName lastName email')
        .populate('shippingAddress');

        if (!order) {
            return res.status(404).render('error', { 
                message: 'Order not found or unauthorized',
                error: { status: 404 }
            });
        }

        // Calculate final amount manually since we might need more control
        const activeItemsTotal = order.items.reduce((total, item) => 
            item.status === 'active' ? total + item.itemTotal : total, 0);
        
        const finalAmount = activeItemsTotal + 
            (order.shippingFee || 0) - 
            (order.totalDiscount || 0);

        // Format date
        const invoiceDate = new Date(order.createdAt).toLocaleDateString('en-IN', { 
            day: 'numeric', 
            month: 'long', 
            year: 'numeric',
            timeZone: 'Asia/Kolkata'
        });

        // Format payment method
        const paymentMethodDisplay = {
            'cod': 'Cash on Delivery',
            'razorpay': 'Online Payment',
            'wallet': 'Wallet Payment'
        }[order.paymentMethod] || order.paymentMethod;

        // Format payment status
        const paymentStatusDisplay = order.paymentStatus.charAt(0).toUpperCase() + 
            order.paymentStatus.slice(1).toLowerCase();

        // Convert order to plain object and add computed properties
        const orderData = order.toObject({ getters: true, virtuals: true });
        
        // Prepare invoice data
        const invoiceData = {
            order: {
                ...orderData,
                paymentMethodDisplay,
                paymentStatusDisplay,
                finalAmount: finalAmount // Add calculated final amount
            },
            date: invoiceDate,
            invoiceNumber: `INV-${order.orderNumber}`,
            subtotal: activeItemsTotal.toFixed(2),
            formatCurrency: (amount) => {
                return typeof amount === 'number' ? amount.toFixed(2) : '0.00';
            }
        };

        // Render the invoice
        res.render('invoices', invoiceData);

    } catch (error) {
        console.error('Error generating invoice:', error);
        res.status(500).render('error', {
            message: 'Failed to generate invoice',
            error: process.env.NODE_ENV === 'development' ? error : {}
        });
    }
};

module.exports = {
    getUserOrders,
    getOrderDetails,
    cancelOrderItem,
    returnOrderItem,
    retryPayment,
    createRazorpayOrder,
    verifyRazorpayPayment,
    generateUserInvoice
}