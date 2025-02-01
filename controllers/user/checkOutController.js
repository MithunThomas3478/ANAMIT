const Cart = require('../../models/cartSchema');
const User = require('../../models/userSchema');
const Address = require('../../models/addressSchema');
const Order = require('../../models/orderSchema');
const Product = require('../../models/productSchema');
const Wallet = require('../../models/walletSchema');
const Razorpay = require('razorpay');
const crypto = require('crypto');
const mongoose = require('mongoose');

const getCheckout = async (req, res) => {
    try {
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

        // Existing cart processing code remains the same
        const processedItems = cart.items.map(item => ({
            productId: item.product._id,
            product: item.product,
            productName: item.product.productName,
            productImage: item.product.variants.find(v => 
                v.colorName === item.selectedColor.colorName
            )?.productImage[0] || '',
            selectedColor: item.selectedColor,
            selectedSize: item.selectedSize,
            quantity: item.quantity,
            price: item.price,
            itemTotal: item.price * item.quantity
        }));

        const totalAmount = processedItems.reduce((sum, item) => sum + item.itemTotal, 0);
        const shippingFee = 128;
        const totalDiscount = 0;
        const finalAmount = totalAmount - totalDiscount + shippingFee;

        const checkoutData = {
            items: processedItems,
            totalAmount,
            totalDiscount,
            shippingFee,
            finalAmount
        };

        // Updated template data to include userWallet
        const templateData = {
            checkoutData,
            addresses,
            user: {
                name: req.user.name,
                email: req.user.email,
                phone: req.user.phone
            },
            userWallet: {
                balance: wallet?.balance || 0
            },
            razorpayKeyId: process.env.RAZORPAY_KEY_ID,
            storeName: process.env.STORE_NAME || 'Your Store Name',
            pageTitle: 'Checkout'
        };

        res.render('checkout', templateData);

    } catch (error) {
        console.error('Error in getCheckout:', error);
        res.status(500).render('error', { 
            message: 'Failed to load checkout page',
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

const placeOrder = async (req, res) => {
    let session;
    try {
        // Start session without transaction for now
        session = await mongoose.startSession();

        const { addressId, items, totalAmount, paymentMethod, paymentDetails } = req.body;
        const userId = req.user._id;

        if (!addressId || !items || !totalAmount || !paymentMethod) {
            throw new Error('Missing required order information');
        }

        // Validate address
        const address = await Address.findById(addressId);
        if (!address || address.userId.toString() !== userId.toString()) {
            throw new Error('Invalid delivery address');
        }

        // Calculate totals with validation - MODIFIED THIS PART
        const calculatedTotal = parseFloat(items.reduce((sum, item) => sum + item.itemTotal, 0).toFixed(2));
        const finalAmount = parseFloat((calculatedTotal + 128).toFixed(2)); // Adding shipping fee
        const requestedAmount = parseFloat(totalAmount);

        // Add some logging to debug
        console.log('Calculated Total:', calculatedTotal);
        console.log('Final Amount:', finalAmount);
        console.log('Requested Amount:', requestedAmount);

        // Use a small epsilon for floating-point comparison
        if (Math.abs(finalAmount - requestedAmount) > 0.01) {
            throw new Error(`Order amount mismatch. Expected: ${finalAmount}, Got: ${requestedAmount}`);
        }

        // Rest of your existing code...

        // Handle wallet payment - MODIFIED
        if (paymentMethod === 'wallet') {
            const wallet = await Wallet.findOne({ user: userId });
            if (!wallet || wallet.balance < finalAmount) {
                throw new Error('Insufficient wallet balance');
            }

            // Deduct amount from wallet
            wallet.balance -= finalAmount;
            wallet.transactions.push({
                type: 'debit',
                amount: finalAmount,
                description: 'Order payment',
                date: new Date()
            });
            await wallet.save();
        }

        // Create order with correct amounts
        const order = new Order({
            orderId: await generateOrderId(),
            orderNumber: await generateOrderNumber(),
            user: userId,
            items: items.map(item => ({
                product: item.productId,
                productName: item.productName,
                productImage: item.productImage,
                selectedColor: item.selectedColor,
                selectedSize: item.selectedSize,
                quantity: item.quantity,
                price: item.price,
                itemTotal: item.itemTotal,
                status: 'active'
            })),
            shippingAddress: {
                fullName: address.fullName,
                streetAddress: address.streetAddress,
                city: address.city,
                state: address.state,
                pincode: address.pincode,
                phoneNumber: address.phoneNumber
            },
            totalAmount: calculatedTotal,
            shippingFee: 128,
            finalAmount: finalAmount,
            paymentMethod,
            paymentStatus: paymentMethod === 'cod' ? 'pending' : 'completed',
            orderStatus: paymentMethod === 'cod' ? 'pending' : 'confirmed',
            paymentDetails: getPaymentDetails(paymentMethod, paymentDetails, finalAmount),
            estimatedDelivery: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
        });

        // Save order and update cart without transaction
        await order.save();
        await Cart.findOneAndUpdate(
            { user: userId, active: true },
            { active: false, lastActive: new Date() }
        );

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
    } finally {
        if (session) {
            await session.endSession();
        }
    }
};

function getPaymentDetails(paymentMethod, paymentDetails, finalAmount) {
    switch(paymentMethod) {
        case 'razorpay':
            return {
                razorpayPaymentId: paymentDetails?.razorpay_payment_id,
                razorpayOrderId: paymentDetails?.razorpay_order_id,
                razorpaySignature: paymentDetails?.razorpay_signature,
                paidAmount: finalAmount,
                paidAt: new Date()
            };
        case 'wallet':
            return {
                walletTransactionId: new mongoose.Types.ObjectId().toString(),
                paidAmount: finalAmount,
                paidAt: new Date()
            };
        case 'cod':
            return {
                codAmount: finalAmount
            };
        default:
            return {};
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


const addCheckoutAddress = async (req, res) => {
    try {
        const { name, street, city, state, pincode, phone } = req.body;

        // Create new address
        const newAddress = new Address({
            userId: req.user._id,
            fullName: name,
            streetAddress: street,
            city,
            state,
            pincode,
            phoneNumber: phone,
            isDefault: false
        });

        // Save address to database
        await newAddress.save();

        // Add address to user's addresses array
        await User.findByIdAndUpdate(
            req.user._id,
            { $addToSet: { addresses: newAddress._id } }
        );

        // Return the new address data
        return res.status(201).json({
            success: true,
            message: 'Address added successfully',
            address: {
                _id: newAddress._id,
                fullName: name,
                streetAddress: street,
                city,
                state,
                pincode,
                phoneNumber: phone
            }
        });

    } catch (error) {
        console.error('Error adding checkout address:', error);

        // Handle validation errors
        if (error.name === 'ValidationError') {
            return res.status(400).json({
                success: false,
                message: 'Please check all required fields'
            });
        }

        // Handle other errors
        return res.status(500).json({
            success: false,
            message: 'Failed to add address'
        });
    }
};

module.exports ={
    getCheckout,
    placeOrder,
    orderSuccess,
    generateOrderId,
    createRazorpayOrder,
    verifyRazorpayPayment,
    addCheckoutAddress
}