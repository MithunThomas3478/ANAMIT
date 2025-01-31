const Order = require('../../models/orderSchema');
const User = require('../../models/userSchema');

const getOrderManagement = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = 10; // Increased limit for admin view
        const skip = (page - 1) * limit;

        // Get filter parameters
        const status = req.query.status || 'all';
        const date = req.query.date;

        // Build filter query
        let query = {};
        
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

        // Get total count for pagination
        const totalOrders = await Order.countDocuments(query);
        const totalPages = Math.ceil(totalOrders / limit);

        // Fetch orders with pagination and populate necessary fields
        const orders = await Order.find(query)
            .populate({
                path: 'user',
                select: 'name email',
                model: 'User'
            })
            .populate({
                path: 'items.product',
                select: 'name images price variants',
                model: 'Product'
            })
            .populate('shippingAddress')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .lean();

        // Process orders to add customer name and format data
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

        // Render appropriate view based on route
        if (req.originalUrl.startsWith('/admin')) {
            // Admin view
            return res.render('admin/orderManagement', {
                orders: processedOrders,
                currentPage: page,
                totalPages,
                status: status || 'all',
                date: date || '',
                error: null
            });
        } else {
            // User view - filter orders for current user
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

        // Get the order first to check payment method
        const order = await Order.findById(orderId);
        if (!order) {
            return res.status(404).json({ message: 'Order not found' });
        }

        // Create update object
        const updateData = { orderStatus: status };

        // If order is COD and status is being set to delivered, update payment status
        if (status === 'delivered' && order.paymentMethod === 'cod') {
            updateData.paymentStatus = 'completed';
            updateData['paymentDetails.paidAmount'] = order.totalAmount;
            updateData['paymentDetails.paidAt'] = new Date();
        }

        // Update the order with all changes
        const updatedOrder = await Order.findByIdAndUpdate(
            orderId,
            updateData,
            { new: true }
        ).populate('user', 'name email');

        // Emit socket events for both status updates
        const io = req.app.get('socketio');
        io.emit('orderStatusUpdate', {
            orderId: updatedOrder._id,
            orderNumber: updatedOrder.orderNumber,
            status: updatedOrder.orderStatus,
            paymentStatus: updatedOrder.paymentStatus,
            userId: updatedOrder.user._id
        });

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

        // Render invoice template
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

module.exports = {
    getOrderManagement,
    updateOrderStatus,
    generateInvoice
}