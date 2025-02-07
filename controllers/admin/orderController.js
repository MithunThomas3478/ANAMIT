const Order = require('../../models/orderSchema');
const User = require('../../models/userSchema');
const Product = require('../../models/productSchema');
const Wallet = require('../../models/walletSchema');

const getOrderManagement = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = 10;
        const skip = (page - 1) * limit;

        // Get filter parameters
        const status = req.query.status || 'all';
        const date = req.query.date;

        // Build filter query
        let query = {};
        if (!req.originalUrl.startsWith('/admin')) {
            query.user = req.user._id;
        }

        if (status && status !== 'all') {
            query.orderStatus = status;
        }

        if (date) {
            const startDate = new Date(date);
            const endDate = new Date(date);
            endDate.setDate(endDate.getDate() + 1);
            query.createdAt = {
                $gte: startDate,
                $lt: endDate
            };
        }

        const totalOrders = await Order.countDocuments(query);
        const totalPages = Math.ceil(totalOrders / limit);

        const orders = await Order.find(query)
            .populate({
                path: 'user',
                select: 'name email',
                model: 'User'
            })
            .sort({ _id: -1 })
            .skip(skip)
            .limit(limit)
            .lean();

        const processedOrders = orders.map(order => ({
            ...order,
            customerName: order.user ? order.user.name : 'Unknown User',
            items: order.items.map(item => ({
                ...item,
                productName: item.productName || (item.product ? item.product.name : 'Unknown Product'),
                productImage: item.product && item.product.images && item.product.images.length > 0 ? item.product.images[0] : '',
                price: item.price || (item.product ? item.product.price : 0)
            }))
        }));

        if (req.originalUrl.startsWith('/admin')) {
            return res.render('admin/orderManagement', {
                orders: processedOrders,
                currentPage: page,
                totalPages,
                status: status || 'all',
                date: date || '',
                error: null
            });
        } else {
            const userOrders = processedOrders.filter(order => 
                order.user && order.user._id.toString() === req.user._id.toString()
            );

            return res.render('user/userOrder', {
                orders: userOrders,
                currentPage: page,
                totalPages: Math.ceil(userOrders.length / limit),
                status: status || 'all',
                date: date || '',
                error: null,
                user: req.user
            });
        }

    } catch (error) {
        console.error('Error in order management:', error);
        const viewPath = req.originalUrl.startsWith('/admin') ? 'admin/orderManagement' : 'user/userOrder';
        res.render(viewPath, {
            orders: [],
            currentPage: 1,
            totalPages: 0,
            status: 'all',
            date: '',
            error: 'Failed to fetch orders. Please try again.',
            user: req.user
        });
    }
};

const updateOrderStatus = async (req, res) => {
    try {
        const { orderId } = req.params;
        const { status } = req.body;

        if (!orderId || !status) {
            return res.status(400).json({ message: 'Order ID and status are required' });
        }

        const validStatuses = ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled', 'returned'];
        if (!validStatuses.includes(status)) {
            return res.status(400).json({ message: 'Invalid status value' });
        }

        const order = await Order.findById(orderId);
        if (!order) {
            return res.status(404).json({ message: 'Order not found' });
        }

        const updateData = { orderStatus: status };

        if (status === 'delivered' && order.paymentMethod === 'cod') {
            updateData.paymentStatus = 'completed';
            updateData['paymentDetails.paidAmount'] = order.totalAmount;
            updateData['paymentDetails.paidAt'] = new Date();
        }

        const updatedOrder = await Order.findByIdAndUpdate(
            orderId,
            updateData,
            { new: true }
        ).populate('user', 'name email');

        res.json({ 
            message: 'Order status updated successfully',
            order: updatedOrder
        });
    } catch (error) {
        console.error('Error updating order status:', error);
        res.status(500).json({ message: 'Failed to update order status' });
    }
};

const generateInvoice = async (req, res) => {
    try {
        const { orderId } = req.params;
        
        const order = await Order.findById(orderId)
            .populate('user', 'firstName lastName email address')
            .populate('items.product', 'name price');

        if (!order) {
            return res.status(404).render('error', { 
                message: 'Order not found',
                error: { status: 404 }
            });
        }

        res.render('invoice', {
            order,
            date: new Date(order.createdAt).toLocaleDateString(),
            invoiceNumber: `INV-${order.orderNumber}`,
            error: null
        });
    } catch (error) {
        console.error('Error generating invoice:', error);
        res.status(500).render('error', {
            message: 'Failed to generate invoice',
            error: { status: 500 }
        });
    }
};

const getOrderDetails = async (req, res) => {
    try {
        const { orderId } = req.params;

        const order = await Order.findById(orderId)
            .populate('user', 'name email')
            .populate('items.product', 'name images');

        if (!order) {
            return res.status(404).render('error', {
                message: 'Order not found',
                error: { status: 404 }
            });
        }

        const activeItemsTotal = order.items
            .filter(item => item.status === 'active')
            .reduce((total, item) => total + item.itemTotal, 0);

        const finalAmount = activeItemsTotal - (order.totalDiscount || 0) + order.shippingFee;

        const processedOrder = {
            ...order._doc,
            items: order.items.map(item => ({
                ...item.toObject(),
                productName: item.productName || (item.product ? item.product.name : 'Unknown Product'),
                productImage: item.productImage || (item.product && item.product.images && item.product.images.length > 0 
                    ? item.product.images[0] 
                    : '/images/placeholder.jpg')
            })),
            finalAmount: finalAmount
        };

        res.render('admin/orderDetailsView', {
            order: processedOrder,
            user: req.user,
            title: `Order Details #${order.orderNumber}`
        });

    } catch (error) {
        console.error('Error fetching order details:', error);
        res.status(500).render('error', {
            message: 'Error fetching order details',
            error: process.env.NODE_ENV === 'development' ? error : {}
        });
    }
};

const handleReturnRequest = async (req, res) => {
    try {
        const { orderId, itemId } = req.params;
        const { action, rejectReason } = req.body;

        const order = await Order.findById(orderId)
            .populate('user', 'name email')
            .populate('items.product');  // Make sure product is populated

        if (!order) {
            return res.status(404).json({
                success: false,
                message: 'Order not found'
            });
        }

        const orderItem = order.items.id(itemId);
        if (!orderItem) {
            return res.status(404).json({
                success: false,
                message: 'Item not found in order'
            });
        }

        if (orderItem.status !== 'return_pending') {
            return res.status(400).json({
                success: false,
                message: 'Item is not pending return approval'
            });
        }

        if (action === 'approve') {
            orderItem.status = 'returned';
            orderItem.returnDetails.status = 'approved';
            
            const refundAmount = orderItem.returnDetails.refundAmount;
            
            // Handle wallet refund
            let wallet = await Wallet.findOne({ user: order.user });
            if (!wallet) {
                wallet = new Wallet({
                    user: order.user,
                    balance: 0
                });
                await wallet.save();
            }

            const walletTransaction = await wallet.credit(
                refundAmount,
                `Refund for returned item from order #${order.orderNumber}`,
                {
                    reason: 'return_refund',
                    orderId: order._id,
                    itemId: itemId
                }
            );

            orderItem.returnDetails.refundStatus = 'completed';
            orderItem.returnDetails.processedAt = new Date();
            orderItem.returnDetails.walletTransactionId = walletTransaction._id;

            // Update product inventory
            if (orderItem.product) {
                try {
                    const product = await Product.findById(orderItem.product);
                    if (product) {
                        // Find the specific variant that matches the returned item
                        const variant = product.variants.find(v => 
                            v.colorName === orderItem.selectedColor.colorName);
                        
                        if (variant) {
                            // Find the specific size variant
                            const sizeVariant = variant.colorVariant.find(sv => 
                                sv.size === orderItem.selectedSize);
                            
                            if (sizeVariant) {
                                // Add the returned quantity back to stock
                                sizeVariant.stock += orderItem.quantity;
                                
                                // Save the product with updated inventory
                                await product.save();
                                
                                console.log(`Updated inventory for product ${product._id}, new stock: ${sizeVariant.stock}`);
                            }
                        }
                    }
                } catch (error) {
                    console.error('Error updating product inventory:', error);
                    // Consider whether you want to fail the entire return process if inventory update fails
                    // For now, we'll continue with the return process
                }
            }

        } else if (action === 'reject') {
            orderItem.status = 'active';
            orderItem.returnDetails.status = 'rejected';
            orderItem.returnDetails.comments = rejectReason;
        }

        // Update order status history
        order.statusHistory.push({
            status: action === 'approve' ? 'returned' : 'return_rejected',
            timestamp: new Date(),
            comment: action === 'approve' ? 
                'Return request approved' : 
                `Return request rejected: ${rejectReason}`
        });

        // Update overall order status
        order.updateOrderStatus();
        await order.save();

        return res.status(200).json({
            success: true,
            message: `Return request ${action}ed successfully`,
            details: {
                orderStatus: order.orderStatus,
                itemStatus: orderItem.status,
                refundAmount: action === 'approve' ? orderItem.returnDetails.refundAmount : null
            }
        });

    } catch (error) {
        console.error('Error handling return request:', error);
        return res.status(500).json({
            success: false,
            message: 'Error processing return request',
            error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
        });
    }
};

const returnOrderItem = async (req, res) => {
    try {
        const { orderId, itemId } = req.params;
        const userId = req.user._id;
        const { reason, condition, comments } = req.body;

        if (!orderId || !itemId) {
            return res.status(400).json({
                success: false,
                message: 'Order ID and Item ID are required'
            });
        }

        if (!reason || !condition) {
            return res.status(400).json({
                success: false,
                message: 'Return reason and condition are required'
            });
        }

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

        const orderItem = order.items.id(itemId);
        if (!orderItem) {
            return res.status(404).json({
                success: false,
                message: 'Item not found in order'
            });
        }

        const eligibilityCheck = validateReturnEligibility(order, orderItem);
        if (!eligibilityCheck.eligible) {
            return res.status(400).json({
                success: false,
                message: eligibilityCheck.message,
                details: eligibilityCheck.details
            });
        }

        const refundAmount = calculateRefundAmount(orderItem, order);

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

        order.statusHistory.push({
            status: 'return_pending',
            timestamp: new Date(),
            comment: `Return requested: ${reason}`
        });

        order.updateOrderStatus();
        await order.save();

        return res.status(200).json({
            success: true,
            message: 'Return request submitted successfully',
            details: {
                orderNumber: order.orderNumber,
                returnId: orderItem.returnDetails._id,
                refundAmount,
                refundStatus: orderItem.returnDetails.refundStatus
            }
        });

    } catch (error) {
        console.error('Return processing error:', error);
        return res.status(500).json({
            success: false,
            message: 'Error processing return request',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Helper Functions
const validateReturnEligibility = (order, orderItem) => {
    if (order.orderStatus !== 'delivered') {
        return {
            eligible: false,
            message: 'Order must be delivered to process return',
            details: { orderStatus: order.orderStatus }
        };
    }

    if (orderItem.status !== 'active') {
        return {
            eligible: false,
            message: 'Item is not eligible for return',
            details: { itemStatus: orderItem.status }
        };
    }

    const deliveredDate = order.statusHistory
        .find(h => h.status === 'delivered')?.timestamp;
    
    if (!deliveredDate) {
        return {
            eligible: false,
            message: 'Delivery date not found',
            details: { statusHistory: order.statusHistory }
        };
    }

    const daysSinceDelivery = Math.floor(
        (Date.now() - deliveredDate.getTime()) / (1000 * 60 * 60 * 24)
    );

    if (daysSinceDelivery > 7) {
        return {
            eligible: false,
            message: 'Return window has expired',
            details: {
                deliveryDate: deliveredDate,
                daysSinceDelivery,
                maxReturnDays: 7
            }
        };
    }
    return {
        eligible: true,
        details: {
            daysRemaining: 7 - daysSinceDelivery
        }
    };
};






module.exports = {
    getOrderManagement,
    updateOrderStatus,
    generateInvoice,
    getOrderDetails,
    returnOrderItem,
    validateReturnEligibility,
    handleReturnRequest
}