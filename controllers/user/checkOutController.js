const mongoose = require('mongoose');
const Cart = require('../../models/cartSchema');
const Address = require('../../models/addressSchema');
const Order = require('../../models/orderSchema');
const Product = require('../../models/productSchema');
// controllers/checkoutController.js

// Update the getCheckoutPage function
const getCheckout = async (req, res) => {
    try {
        // Fetch both cart and addresses concurrently
        const [cart, addresses] = await Promise.all([
            Cart.findOne({ 
                user: req.user._id, 
                active: true 
            }).populate({
                path: 'items.product',
                select: 'productName variants price'
            }),
            Address.find({ userId: req.user._id }) // Add this line to fetch addresses
        ]);

        if (!cart || cart.items.length === 0) {
            return res.redirect('/cart');
        }

        // Calculate totals
        const itemsTotal = cart.items.reduce((total, item) => 
            total + (item.price * item.quantity), 0);
        const shipping = 128;

        const checkoutData = {
            items: cart.items.map(item => ({
                productId: item.product._id,
                product: item.product,
                colorName: item.selectedColor.colorName,
                size: item.selectedSize,
                quantity: item.quantity,
                price: item.price,
                total: item.price * item.quantity
            })),
            totalPrice: itemsTotal,
            shipping: shipping,
            grandTotal: itemsTotal + shipping
        };

        console.log('Checkout Data:', {
            totalPrice: checkoutData.totalPrice,
            shipping: checkoutData.shipping,
            grandTotal: checkoutData.grandTotal
        });

        // Pass both checkoutData and addresses to the template
        res.render('checkout', { checkoutData, addresses });
    } catch (error) {
        console.error('Error loading checkout page:', error);
        res.status(500).render('error', { 
            message: 'Failed to load checkout page. Please try again.' 
        });
    }
};


   const placeOrder = async (req, res) => {
        try {
            const { addressId, items, totalAmount } = req.body;
            const userId = req.user._id;

            console.log('Order Request Data:', {
                addressId,
                userId,
                totalAmount,
                items: items.length
            });

            // 1. Validate address
            const address = await Address.findOne({
                _id: addressId,
                userId: userId
            });

            console.log('Found Address:', address);

            if (!address) {
                throw new Error('Invalid delivery address');
            }

            // 2. Get cart and validate items
            const cart = await Cart.findOne({ 
                user: userId,
                active: true 
            }).populate('items.product');

            if (!cart || cart.items.length === 0) {
                throw new Error('Cart is empty');
            }

            // 3. Validate stock and prepare order items
            const orderItems = [];
            let calculatedTotal = 0;

            console.log('Starting item calculations...');
            for (const cartItem of cart.items) {
                const product = await Product.findById(cartItem.product._id);
                console.log('Processing item:', {
                    productId: cartItem.product._id,
                    price: cartItem.price,
                    quantity: cartItem.quantity,
                    itemTotal: cartItem.price * cartItem.quantity
                });
                
                // Find the specific variant
                const variant = product.variants.find(v => 
                    v.colorName === cartItem.selectedColor.colorName
                );
                
                if (!variant) {
                    throw new Error(`Variant not found for product: ${product.productName}`);
                }

                // Find size variant
                const sizeVariant = variant.colorVariant.find(sv => 
                    sv.size === cartItem.selectedSize
                );

                if (!sizeVariant) {
                    throw new Error(`Size variant not found for product: ${product.productName}`);
                }

                // Check stock
                if (sizeVariant.stock < cartItem.quantity) {
                    throw new Error(`Insufficient stock for ${product.productName}`);
                }

                // Calculate item total
                const itemTotal = cartItem.price * cartItem.quantity;
                calculatedTotal += itemTotal;

                // Prepare order item
                orderItems.push({
                    product: product._id,
                    productName: product.productName,
                    selectedColor: cartItem.selectedColor,
                    selectedSize: cartItem.selectedSize,
                    quantity: cartItem.quantity,
                    price: cartItem.price,
                    itemTotal: itemTotal
                });
            }

            console.log('Final calculations:', {
                calculatedTotal,
                shippingFee: 128,
                totalWithShipping: calculatedTotal + 128,
                receivedTotal: totalAmount,
                difference: Math.abs((calculatedTotal + 128) - totalAmount)
            });

            // 4. Validate total amount (including shipping fee)
            const expectedTotal = calculatedTotal + 128; // Add shipping fee
            if (Math.abs(expectedTotal - totalAmount) > 1) {
                throw new Error(`Order total mismatch. Expected: ${expectedTotal} (items: ${calculatedTotal} + shipping: 128), Received: ${totalAmount}`);
            }

            // 5. Create order
            const [orderNumber, orderId] = await Promise.all([
                Order.generateOrderNumber(),
                Order.generateOrderId()
            ]);

            const order = new Order({
                orderId,
                orderNumber,
                user: userId,
                items: orderItems,
                shippingAddress: addressId,
                totalAmount: totalAmount,
                shippingFee: 128,
                paymentMethod: 'cod',
                paymentStatus: 'pending',
                orderStatus: 'pending',
                statusHistory: [{
                    status: 'pending',
                    timestamp: new Date(),
                    comment: 'Order placed successfully'
                }]
            });

            await order.save();

            // 6. Clear cart
            await Cart.findByIdAndUpdate(
                cart._id,
                { 
                    active: false,
                    lastActive: new Date()
                }
            );

            // Send success response
            res.status(200).json({
                success: true,
                message: 'Order placed successfully',
                orderId: order._id,
                orderNumber: order.orderNumber
            });

        } catch (error) {
            console.error('Order placement error:', error);
            res.status(400).json({
                success: false,
                message: error.message || 'Failed to place order'
            });
        }
    }


// Helper function to generate unique order number
async function generateOrderNumber() {
    const date = new Date();
    const year = date.getFullYear().toString().slice(-2);
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    
    // Get count of orders for today
    const todayStart = new Date(date.setHours(0, 0, 0, 0));
    const todayEnd = new Date(date.setHours(23, 59, 59, 999));
    
    const orderCount = await Order.countDocuments({
        createdAt: {
            $gte: todayStart,
            $lte: todayEnd
        }
    });

    const sequence = (orderCount + 1).toString().padStart(4, '0');
    return `ORD${year}${month}${day}${sequence}`;
}

// Helper function to generate unique order id
async function generateOrderId() {
    return mongoose.Types.ObjectId();
}

const orderSuccess = async (req, res) => {
    try {
        res.render('orderSuccess', {
            orderId: req.params.orderId,
            storeName: 'Your Store Name'
        });
    } catch (error) {
        res.status(500).render('error', { 
            message: 'Something went wrong' 
        });
    }
};
module.exports ={
    getCheckout,
    placeOrder,
    orderSuccess,
    generateOrderId
}