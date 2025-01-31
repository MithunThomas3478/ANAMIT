const Product = require("../../models/productSchema");
const Category = require("../../models/categorySchema");
const Cart = require('../../models/cartSchema');
const Address = require('../../models/addressSchema');
const Order = require('../../models/orderSchema');
const User = require("../../models/userSchema");

const getUserOrders = async (req, res) => {
    try {
        const userId = req.user._id;
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
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

        // Render orders page
        res.render('order', {
            orders,
            currentPage: page,
            totalPages,
            totalOrders,
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

        // Render order details page
        res.render('orderViewDetails', {
            order,
            user: req.user
        });
    } catch (error) {
        console.error('Error fetching order details:', error);
        res.status(500).render('error', {
            message: 'Error fetching order details',
            error: process.env.NODE_ENV === 'development' ? error : {}
        });
    }
};

const cancelOrder = async (req, res) => {
    try {
        const orderId = req.params.orderId;
        const userId = req.user._id;
        const { reason } = req.body;

        const order = await Order.findOne({
            orderId: orderId,
            user: userId
        });

        if (!order) {
            req.flash('error', 'Order not found');
            return res.redirect('/orders');
        }

        if (!order.canBeCancelled()) {
            req.flash('error', 'This order cannot be cancelled');
            return res.redirect(`/orders/${orderId}`);
        }

        // Update order status and details
        order.orderStatus = 'cancelled';
        order.cancelDetails = {
            reason: reason || 'Cancelled by user',
            cancelledAt: new Date(),
            cancelledBy: 'user',
            refundStatus: order.paymentStatus === 'completed' ? 'pending' : 'not_applicable'
        };

        // Handle refund if payment was already made
        if (order.paymentStatus === 'completed') {
            if (order.paymentMethod === 'razorpay') {
                await handleRazorpayRefund(order);
            } else if (order.paymentMethod === 'wallet') {
                await handleWalletRefund(order, req.user);
            }
        }

        await order.save();
        req.flash('success', 'Order cancelled successfully');
        res.redirect('/orders');

    } catch (error) {
        console.error('Error cancelling order:', error);
        req.flash('error', 'Error cancelling order');
        res.redirect(`/orders/${req.params.orderId}`);
    }
};

module.exports = {
    getUserOrders,
    getOrderDetails,
    cancelOrder
}