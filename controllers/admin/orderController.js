const Order = require('../../models/orderSchema');
const User = require('../../models/userSchema');
const Product = require('../../models/productSchema');
const Wallet = require('../../models/walletSchema');
const mongoose = require('mongoose')

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

        // Find the order first - don't use findByIdAndUpdate yet
        const order = await Order.findById(orderId);
        if (!order) {
            return res.status(404).json({ message: 'Order not found' });
        }

        // Check if payment is pending or failed for Razorpay orders
        if (order.paymentMethod === 'razorpay' && 
            (order.paymentStatus === 'pending' || order.paymentStatus === 'failed')) {
            return res.status(400).json({ 
                message: `Cannot update order status while payment is ${order.paymentStatus}`
            });
        }

        // Check if any items have pending returns
        const hasPendingReturns = order.items.some(item => item.status === 'return_pending');
        if (hasPendingReturns) {
            return res.status(400).json({ 
                message: 'Cannot update order status while return requests are pending'
            });
        }

        // Modified: Check if the order is in specific final states that shouldn't be updated
        // Now allowing partially_cancelled and partially_returned orders to be processed
        const finalUnupdatableStates = ['cancelled', 'delivered', 'returned'];
        if (finalUnupdatableStates.includes(order.orderStatus)) {
            return res.status(400).json({ 
                message: 'Cannot update order in final state'
            });
        }

        // Don't allow setting status to cancelled if order is partially_cancelled
        if (status === 'cancelled' && (order.orderStatus === 'partially_cancelled' || order.orderStatus === 'partially_returned')) {
            return res.status(400).json({
                message: 'Cannot cancel an order that is already partially cancelled or returned. Please cancel individual items instead.'
            });
        }

        // Check if there are any active items left to process
        const activeItems = order.items.filter(item => item.status === 'active');
        if (activeItems.length === 0) {
            return res.status(400).json({
                message: 'No active items remaining in this order'
            });
        }

        // Set the new status directly on the order object
        order.orderStatus = status;

        // Update payment status for COD orders when delivered
        if (status === 'delivered' && order.paymentMethod === 'cod') {
            order.paymentStatus = 'completed';
            if (!order.paymentDetails) {
                order.paymentDetails = {};
            }
            order.paymentDetails.paidAmount = order.totalAmount;
            order.paymentDetails.paidAt = new Date();
        }

        // Add to status history - this is now handled by the schema's pre-save hook
        // But we manually add the comment for clarity
        const comment = `Order status updated to ${status}`;

        // Save the order - this will trigger the pre-save middleware
        const updatedOrder = await order.save();

        // Now populate user details for the response
        await updatedOrder.populate('user', 'name email');

        res.json({ 
            message: 'Order status updated successfully',
            order: updatedOrder
        });
    } catch (error) {
        console.error('Error updating order status:', error);
        res.status(500).json({ 
            message: 'Failed to update order status',
            error: error.message
        });
    }
};

const generateInvoice = async (req, res) => {
    try {
        const orderId = req.params.orderId;
        
        // Validate if orderId is a valid ObjectId
        if (!mongoose.Types.ObjectId.isValid(orderId)) {
            return res.status(400).render('error', { 
                message: 'Invalid order ID format',
                error: { status: 400 }
            });
        }
        
        // Fetch order without lean() to keep virtuals
        const order = await Order.findById(orderId)
            .populate({
                path: 'items.product',
                select: 'productName variants category',
                populate: {
                    path: 'category',
                    select: 'name'
                }
            })
            .populate('user', 'firstName lastName email');

        if (!order) {
            return res.status(404).render('error', { 
                message: 'Order not found or unauthorized',
                error: { status: 404 }
            });
        }

        // Special handling for cancelled or returned orders
        const allItemsCancelledOrReturned = order.items.every(item => 
            item.status === 'cancelled' || item.status === 'returned');

        // Use a different calculation method for completely cancelled/returned orders
        let activeItemsTotal, applicableDiscount, shipping, calculatedFinalAmount;

        if (allItemsCancelledOrReturned) {
            // For cancelled/returned orders, we'll show the original values with a note
            activeItemsTotal = order.totalAmount;
            applicableDiscount = order.totalDiscount;
            shipping = order.shippingFee;
            calculatedFinalAmount = order.totalAmount - order.totalDiscount + order.shippingFee;
        } else {
            // Normal calculation for orders with active items
            activeItemsTotal = order.getActiveItemsTotal();
            const activeItemsRatio = order.totalAmount > 0 ? activeItemsTotal / order.totalAmount : 0;
            applicableDiscount = order.totalDiscount * activeItemsRatio;
            const isAllItemsActive = order.items.every(item => item.status === 'active');
            shipping = isAllItemsActive ? order.shippingFee : 0;
            calculatedFinalAmount = activeItemsTotal - applicableDiscount + shipping;
        }

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

        // Get all item details with status for the invoice
        const itemDetails = order.items.map(item => {
            return {
                ...item.toObject(),
                statusDisplay: item.status.charAt(0).toUpperCase() + item.status.slice(1),
                isActive: item.status === 'active'
            };
        });

        // Convert order to plain object and add computed properties
        const orderData = order.toObject({ getters: true, virtuals: true });
        
        // Prepare invoice data with detailed breakdown for transparency
        const invoiceData = {
            order: {
                ...orderData,
                items: itemDetails,
                paymentMethodDisplay,
                paymentStatusDisplay,
                calculatedFinalAmount: calculatedFinalAmount,
                isFullyCancelledOrReturned: allItemsCancelledOrReturned
            },
            date: invoiceDate,
            invoiceNumber: `INV-${order.orderNumber}`,
            // Include breakdown data for debugging and clarity
            breakdown: {
                activeItemsTotal: activeItemsTotal.toFixed(2),
                totalDiscount: order.totalDiscount.toFixed(2),
                applicableDiscount: applicableDiscount.toFixed(2),
                shippingFee: shipping.toFixed(2),
                allItemsActive: order.items.every(item => item.status === 'active'),
                totalItems: order.items.length,
                activeItems: order.items.filter(item => item.status === 'active').length,
                cancelledItems: order.items.filter(item => item.status === 'cancelled').length,
                returnedItems: order.items.filter(item => item.status === 'returned').length
            },
            subtotal: activeItemsTotal.toFixed(2),
            formatCurrency: (amount) => {
                return typeof amount === 'number' ? amount.toFixed(2) : '0.00';
            }
        };

        // For debugging purposes
        console.log('Invoice data for order:', orderId);
        console.log('Is fully cancelled/returned:', allItemsCancelledOrReturned);
        console.log('Active items total:', activeItemsTotal);
        console.log('Applicable discount:', applicableDiscount);
        console.log('Shipping fee:', shipping);
        console.log('Calculated final amount:', calculatedFinalAmount);

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

        // Calculate actual total without any discounts
        const actualTotal = order.items.reduce((total, item) => {
            const price = Number(item.price) || 0;
            const quantity = Number(item.quantity) || 0;
            return total + (price * quantity);
        }, 0);

        // Calculate discounts
        const productOffersTotal = order.items.reduce((total, item) => {
            const price = Number(item.price) || 0;
            const quantity = Number(item.quantity) || 0;
            const productOffer = Number(item.appliedProductOffer) || 0;
            return total + ((price * quantity * productOffer) / 100);
        }, 0);

        const categoryOffersTotal = order.items.reduce((total, item) => {
            const price = Number(item.price) || 0;
            const quantity = Number(item.quantity) || 0;
            const categoryOffer = Number(item.appliedCategoryOffer) || 0;
            return total + ((price * quantity * categoryOffer) / 100);
        }, 0);

        const couponDiscount = order.coupon && typeof order.coupon.discountAmount === 'number' 
            ? Number(order.coupon.discountAmount) 
            : 0;

        const shippingFee = Number(order.shippingFee) || 0;

        // Calculate final amount
        const finalAmount = Math.max(0, actualTotal - productOffersTotal - categoryOffersTotal - couponDiscount + shippingFee);

        const processedOrder = {
            ...order._doc,
            items: order.items.map(item => {
                const price = Number(item.price) || 0;
                const quantity = Number(item.quantity) || 0;
                const actualItemPrice = price * quantity;
                const productOffer = Number(item.appliedProductOffer) || 0;
                const categoryOffer = Number(item.appliedCategoryOffer) || 0;
                const productDiscount = (actualItemPrice * productOffer) / 100;
                const categoryDiscount = (actualItemPrice * categoryOffer) / 100;

                return {
                    ...item.toObject(),
                    productName: item.productName || (item.product ? item.product.name : 'Unknown Product'),
                    productImage: item.productImage || (item.product && item.product.images && item.product.images.length > 0 
                        ? item.product.images[0] 
                        : '/images/placeholder.jpg'),
                    actualPrice: price,
                    actualItemTotal: actualItemPrice,
                    productDiscount,
                    categoryDiscount,
                    finalPrice: actualItemPrice - productDiscount - categoryDiscount
                };
            }),
            orderSummary: {
                actualTotal: Number(actualTotal.toFixed(2)),
                productOffersTotal: Number(productOffersTotal.toFixed(2)),
                categoryOffersTotal: Number(categoryOffersTotal.toFixed(2)),
                couponDiscount: Number(couponDiscount.toFixed(2)),
                shippingFee: Number(shippingFee.toFixed(2)),
                finalAmount: Number(finalAmount.toFixed(2)),
                totalDiscount: Number((productOffersTotal + categoryOffersTotal + couponDiscount).toFixed(2))
            }
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

        console.log('Return request received:', { 
            orderId, 
            itemId, 
            action, 
            rejectReason, 
            body: req.body 
        });

        // Input validation
        if (!['approve', 'reject'].includes(action)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid action specified'
            });
        }

        if (action === 'reject' && !rejectReason) {
            return res.status(400).json({
                success: false,
                message: 'Rejection reason is required'
            });
        }

        // Find order and populate necessary fields
        const order = await Order.findById(orderId)
            .populate('user')
            .populate('items.product');

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

        if (orderItem.status !== 'return_pending') {
            return res.status(400).json({
                success: false,
                message: 'Item is not pending return approval'
            });
        }

        if (action === 'approve') {
            // Handle return approval
            orderItem.status = 'returned';
            orderItem.returnDetails.status = 'approved';
            orderItem.returnDetails.processedAt = new Date();

            // Process refund only if payment was completed
            if (order.paymentStatus === 'completed') {
                try {
                    // Find or create wallet
                    let wallet = await Wallet.findOne({ user: order.user._id });
                    if (!wallet) {
                        wallet = new Wallet({
                            user: order.user._id,
                            balance: 0
                        });
                        await wallet.save();
                    }

                    // Add refund to wallet
                    const walletTransaction = await wallet.credit(
                        orderItem.returnDetails.refundAmount,
                        `Refund for returned item from order #${order.orderNumber}`,
                        {
                            reason: 'return_refund',
                            orderId: order._id,
                            itemId: itemId
                        }
                    );

                    // Update return details with refund information
                    orderItem.returnDetails.refundStatus = 'completed';
                    orderItem.returnDetails.walletTransactionId = walletTransaction._id;
                } catch (error) {
                    console.error('Error processing refund:', error);
                    return res.status(500).json({
                        success: false,
                        message: 'Error processing refund'
                    });
                }
            }

            // Update product inventory
            try {
                if (orderItem.product) {
                    const product = await Product.findById(orderItem.product._id);
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
            } catch (error) {
                console.error('Error updating inventory:', error);
            }

        } else {
            // Handle return rejection
            orderItem.status = 'active';  // Change back to active status
            
            // Store rejection details in returnDetails but don't remove the entire object
            orderItem.returnDetails.status = 'rejected';
            orderItem.returnDetails.comments = rejectReason;
            orderItem.returnDetails.processedAt = new Date();
            
            // We keep other return details for reference and to prevent new return requests
        }

        // Update order status history
        order.statusHistory.push({
            status: action === 'approve' ? 'returned' : 'processing',  // Use valid enum value
            timestamp: new Date(),
            comment: action === 'approve' 
                ? `Return approved for item: ${orderItem.productName}`
                : `Return rejected for item: ${orderItem.productName}. Reason: ${rejectReason}`
        });

        // Update overall order status
        const returnedItems = order.items.filter(item => item.status === 'returned');
        const activeItems = order.items.filter(item => item.status === 'active');

        if (returnedItems.length === order.items.length) {
            order.orderStatus = 'returned';
        } else if (returnedItems.length > 0 && activeItems.length > 0) {
            order.orderStatus = 'partially_returned';
        } else {
            order.orderStatus = 'delivered';
        }

        // Save all changes
        await order.save();

        return res.status(200).json({
            success: true,
            message: `Return request ${action === 'approve' ? 'approved' : 'rejected'} successfully`,
            details: {
                orderStatus: order.orderStatus,
                itemStatus: orderItem.status,
                refundAmount: action === 'approve' ? orderItem.returnDetails.refundAmount : null,
                refundStatus: orderItem.returnDetails.refundStatus
            }
        });

    } catch (error) {
        console.error('Error handling return request:', error);
        return res.status(500).json({
            success: false,
            message: 'Error processing return request',
            error: error.message  // Include error message for debugging
        });
    }
};

const returnOrderItem = async (req, res) => {
    try {
        const { orderId, itemId } = req.params;
        const userId = req.user._id;
        const { reason, condition, comments } = req.body;

        // Input validation
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
        const eligibilityCheck = validateReturnEligibility(order, orderItem);
        if (!eligibilityCheck.eligible) {
            return res.status(400).json({
                success: false,
                message: eligibilityCheck.message,
                details: eligibilityCheck.details
            });
        }

        // Calculate refund amount
        const calculateRefundAmount = (orderItem, order) => {
            let refundAmount = orderItem.itemTotal;
        
            // If there were any discounts applied, calculate proportional discount
            if (order.totalDiscount && order.totalDiscount > 0) {
                const itemRatio = orderItem.itemTotal / order.totalAmount;
                const itemDiscount = order.totalDiscount * itemRatio;
                refundAmount -= itemDiscount;
            }
        
            return Math.round(refundAmount * 100) / 100; // Round to 2 decimal places
        };
        

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

        // Add to status history
        order.statusHistory.push({
            status: 'return_pending',
            timestamp: new Date(),
            comment: `Return requested for item: ${orderItem.productName}. Reason: ${reason}`
        });

        // Update order status if needed
        const activeItems = order.items.filter(item => item.status === 'active');
        const returnPendingItems = order.items.filter(item => item.status === 'return_pending');
        
        if (activeItems.length === 0 && returnPendingItems.length === order.items.length) {
            order.orderStatus = 'return_pending';
        } else if (returnPendingItems.length > 0) {
            order.orderStatus = 'partially_returned';
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
                refundStatus: 'pending',
                daysRemaining: eligibilityCheck.details.daysRemaining
            }
        });

    } catch (error) {
        console.error('Return processing error:', error);
        return res.status(500).json({
            success: false,
            message: 'Error processing return request',
            details: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
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

    const deliveryEntry = order.statusHistory
        .filter(status => status.status === 'delivered')
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))[0];

    if (!deliveryEntry) {
        return {
            eligible: false,
            message: 'Delivery date not found',
            details: { statusHistory: order.statusHistory }
        };
    }

    const deliveryDate = new Date(deliveryEntry.timestamp);
    const currentDate = new Date();
    const daysSinceDelivery = Math.floor((currentDate - deliveryDate) / (1000 * 60 * 60 * 24));

    if (daysSinceDelivery > 7) {
        return {
            eligible: false,
            message: 'Return window has expired',
            details: {
                deliveryDate,
                daysSinceDelivery,
                maxReturnDays: 7
            }
        };
    }

    return {
        eligible: true,
        details: {
            daysRemaining: 7 - daysSinceDelivery,
            deliveryDate
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
    handleReturnRequest,
}