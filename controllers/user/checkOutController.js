const mongoose = require('mongoose');
const Cart = require('../../models/cartSchema');
const Address = require('../../models/addressSchema');
const Order = require('../../models/orderSchema');
const Product = require('../../models/productSchema');
const Wallet = require('../../models/walletSchema');
const Razorpay = require('razorpay');
const crypto = require('crypto');

const getCheckout = async (req, res) => {
    try {
        // Fetch cart, addresses, and wallet balance concurrently
        const [cart, addresses, wallet] = await Promise.all([
            Cart.findOne({ 
                user: req.user._id, 
                active: true 
            }).populate({
                path: 'items.product',
                select: 'productName variants price'
            }),
            Address.find({ userId: req.user._id }),
            Wallet.findOne({ user: req.user._id })
        ]);

        if (!cart || cart.items.length === 0) {
            return res.redirect('/cart');
        }

        // Process cart items and calculate totals
        const processedItems = cart.items.map(item => {
            const variant = item.product.variants.find(v => 
                v.colorName === item.selectedColor.colorName
            );

            const productImage = variant?.productImage[0] || '';
            const basePrice = item.price;
            const quantity = item.quantity;
            const itemTotal = basePrice * quantity;

            return {
                productId: item.product._id,
                product: item.product,
                productName: item.product.productName,
                productImage: productImage,
                selectedColor: item.selectedColor,
                selectedSize: item.selectedSize,
                quantity: quantity,
                price: basePrice,
                itemTotal: itemTotal
            };
        });

        // Calculate order totals
        const totalAmount = processedItems.reduce((sum, item) => sum + item.itemTotal, 0);
        const shippingFee = 128;
        const totalDiscount = 0; // Add discount calculation if needed
        const finalAmount = totalAmount - totalDiscount + shippingFee;

        const checkoutData = {
            items: processedItems,
            totalAmount,
            totalDiscount,
            shippingFee,
            finalAmount
        };

        // Prepare data for template
        const templateData = {
            checkoutData,
            addresses,
            user: {
                name: req.user.name,
                email: req.user.email,
                phone: req.user.phone
            },
            walletBalance: wallet?.balance || 0,
            razorpayKeyId: process.env.RAZORPAY_KEY_ID,
            storeName: 'Your Store Name', // Replace with your store name
            pageTitle: 'Checkout'
        };

        // Log checkout data for debugging
        console.log('Checkout Data:', {
            itemCount: processedItems.length,
            totalAmount,
            shippingFee,
            finalAmount,
            addressCount: addresses.length
        });

        res.render('checkout', templateData);

    } catch (error) {
        console.error('Error in getCheckout:', error);
        res.status(500).render('error', { 
            message: 'Failed to load checkout page. Please try again.',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Initialize Razorpay
// In your checkout controller, update the Razorpay initialization:
const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,       // Make consistent
    key_secret: process.env.RAZORPAY_KEY_SECRET // Make consistent
});

// Update the createRazorpayOrder function
const createRazorpayOrder = async (req, res) => {
    try {
        const { amount } = req.body;
        
        if (!amount || amount <= 0) {
            throw new Error('Invalid amount');
        }

        console.log('Creating Razorpay order with amount:', amount);

        const options = {
            amount: Math.round(amount * 100), // Convert to paise and ensure it's an integer
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
            key: process.env.RAZORPAY_ID // Send key to frontend
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
        const {
            razorpay_payment_id,
            razorpay_order_id,
            razorpay_signature
        } = req.body;

        // Verify signature
        const body = razorpay_order_id + '|' + razorpay_payment_id;
        const expectedSignature = crypto
            .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)  // Changed from RAZORPAY_SECRET
            .update(body)
            .digest('hex');

        if (expectedSignature !== razorpay_signature) {
            throw new Error('Invalid payment signature');
        }

        res.status(200).json({
            success: true,
            message: 'Payment verified successfully'
        });

    } catch (error) {
        console.error('Payment verification error:', error);
        res.status(400).json({
            success: false,
            message: 'Payment verification failed'
        });
    }
};

// Modified placeOrder controller to handle Razorpay
const placeOrder = async (req, res) => {
    try {
        const { addressId, items, totalAmount, paymentMethod, paymentDetails } = req.body;
        const userId = req.user._id;

        // Validate address
        const address = await Address.findById(addressId);
        if (!address || address.userId.toString() !== userId.toString()) {
            throw new Error('Invalid delivery address');
        }

        // Find active cart
        const cart = await Cart.findOne({ user: userId, active: true });
        if (!cart) {
            throw new Error('No active cart found');
        }

        // Generate order ID and number
        const orderId = await generateOrderId();
        const orderNumber = await generateOrderNumber();

        // Process order items
        const orderItems = items.map(item => ({
            product: item.productId,
            productName: item.productName,
            productImage: item.productImage,
            selectedColor: item.selectedColor,
            selectedSize: item.selectedSize,
            quantity: item.quantity,
            price: item.price,
            itemTotal: item.itemTotal,
            status: 'active'
        }));

        // Calculate totals
        const calculatedTotal = orderItems.reduce((sum, item) => sum + item.itemTotal, 0);
        
        // Create new order
        const order = new Order({
            orderId,
            orderNumber,
            user: userId,
            items: orderItems,
            shippingAddress: {
                fullName: address.fullName,
                streetAddress: address.streetAddress,
                city: address.city,
                state: address.state,
                pincode: address.pincode,
                phoneNumber: address.phoneNumber
            },
            totalAmount: calculatedTotal,
            shippingFee: 128, // Your fixed shipping fee
            paymentMethod,
            paymentStatus: paymentMethod === 'razorpay' ? 'completed' : 'pending',
            orderStatus: paymentMethod === 'razorpay' ? 'confirmed' : 'pending',
            paymentDetails: paymentMethod === 'razorpay' ? {
                razorpayPaymentId: paymentDetails?.razorpay_payment_id,
                razorpayOrderId: paymentDetails?.razorpay_order_id,
                razorpaySignature: paymentDetails?.razorpay_signature,
                paidAmount: calculatedTotal + 128, // Including shipping fee
                paidAt: new Date()
            } : undefined,
            estimatedDelivery: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
            statusHistory: [{
                status: paymentMethod === 'razorpay' ? 'confirmed' : 'pending',
                timestamp: new Date(),
                comment: paymentMethod === 'razorpay' ? 
                    'Order confirmed with online payment' : 
                    'Order placed with COD payment'
            }]
        });

        // Save order and update cart status
        await Promise.all([
            order.save(),
            Cart.findByIdAndUpdate(cart._id, { 
                active: false,
                lastActive: new Date()
            })
        ]);

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
};

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
    return new mongoose.Types.ObjectId().toString();
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
    generateOrderId,
    createRazorpayOrder,
    verifyRazorpayPayment
}