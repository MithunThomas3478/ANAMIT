const Cart = require('../../models/cartSchema');
const User = require('../../models/userSchema');
const Address = require('../../models/addressSchema');
const Order = require('../../models/orderSchema');
const Product = require('../../models/productSchema');
const Wallet = require('../../models/walletSchema');
const Offer = require('../../models/offerSchema');
const Razorpay = require('razorpay');
const crypto = require('crypto');
const mongoose = require('mongoose');

// Initialize Razorpay
const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET
});

const getCheckout = async (req, res) => {
    try {
        const currentDate = new Date();
        
        // Fetch all required data in parallel
        const [cart, addresses, wallet, activeOffers] = await Promise.all([
            Cart.findOne({ 
                user: req.user._id, 
                active: true 
            }).populate({
                path: 'items.product',
                select: 'productName variants price category'
            }),
            Address.find({ userId: req.user._id }),
            Wallet.findOne({ user: req.user._id }),
            Offer.find({
                isActive: true,
                startDate: { $lte: currentDate },
                endDate: { $gte: currentDate }
            }).lean()
        ]);

        if (!cart || cart.items.length === 0) {
            return res.redirect('/cart');
        }

        // Process cart items with offers
        const processedItems = await Promise.all(cart.items.map(async (item) => {
            // Find applicable offers
            const productOffer = activeOffers.find(
                offer => offer.offerType === 'product' && 
                offer.product?.toString() === item.product._id.toString()
            );

            const categoryOffer = activeOffers.find(
                offer => offer.offerType === 'category' && 
                offer.category?.toString() === item.product.category.toString()
            );

            // Calculate best discount
            const productDiscountPercent = productOffer?.discountPercentage || 0;
            const categoryDiscountPercent = categoryOffer?.discountPercentage || 0;
            const bestDiscountPercent = Math.max(productDiscountPercent, categoryDiscountPercent);

            // Get variant and its image
            const variant = item.product.variants.find(v => 
                v.colorName === item.selectedColor.colorName
            );

            const originalPrice = item.price;
            const discountedPrice = originalPrice * (1 - bestDiscountPercent/100);
            const itemTotal = discountedPrice * item.quantity;

            return {
                productId: item.product._id,
                productName: item.product.productName,
                productImage: variant?.productImage[0] || '',
                selectedColor: item.selectedColor,
                selectedSize: item.selectedSize,
                quantity: item.quantity,
                price: originalPrice,
                discountedPrice,
                discountPercent: bestDiscountPercent,
                offerType: bestDiscountPercent === productDiscountPercent ? 'product' : 'category',
                offerName: bestDiscountPercent === productDiscountPercent ? 
                    productOffer?.name : categoryOffer?.name,
                itemTotal
            };
        }));

        // Calculate order totals
        const subtotal = processedItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);
        const totalDiscount = processedItems.reduce((sum, item) => 
            sum + ((item.price * item.quantity) - item.itemTotal), 0);
        const shippingFee = 128;
        const finalAmount = subtotal - totalDiscount + shippingFee;

        const checkoutData = {
            items: processedItems,
            subtotal,
            totalDiscount,
            shippingFee,
            finalAmount
        };

        res.render('checkout', {
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
        });

    } catch (error) {
        console.error('Error in getCheckout:', error);
        res.status(500).render('error', { 
            message: 'Failed to load checkout page'
        });
    }
};

const createRazorpayOrder = async (req, res) => {
    try {
        const { amount } = req.body;
        
        if (!amount || amount <= 0) {
            throw new Error('Invalid amount');
        }

        const options = {
            amount: Math.round(amount * 100), // Convert to paise
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
            message: 'Failed to create payment order'
        });
    }
};

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
            .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
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

        await newAddress.save();

        // Add to user's addresses
        await User.findByIdAndUpdate(
            req.user._id,
            { $addToSet: { addresses: newAddress._id } }
        );

        res.status(201).json({
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
        console.error('Error adding address:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to add address'
        });
    }
};

const placeOrder = async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const { addressId, items, paymentMethod, paymentDetails } = req.body;
        const userId = req.user._id;

        // Validate input
        if (!addressId || !items || !paymentMethod) {
            throw new Error('Missing required order information');
        }

        // Get address
        const address = await Address.findById(addressId);
        if (!address || address.userId.toString() !== userId.toString()) {
            throw new Error('Invalid delivery address');
        }

        // Calculate totals
        const subtotal = items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
        const totalDiscount = items.reduce((sum, item) => 
            sum + ((item.price * item.quantity) - item.itemTotal), 0);
        const shippingFee = 128;
        const finalAmount = subtotal - totalDiscount + shippingFee;

        // Handle wallet payment
        if (paymentMethod === 'wallet') {
            const wallet = await Wallet.findOne({ user: userId });
            if (!wallet || wallet.balance < finalAmount) {
                throw new Error('Insufficient wallet balance');
            }

            wallet.balance -= finalAmount;
            wallet.transactions.push({
                type: 'debit',
                amount: finalAmount,
                description: 'Order payment',
                date: new Date()
            });
            await wallet.save({ session });
        }

        // Create order
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
                discountedPrice: item.discountedPrice,
                discountPercent: item.discountPercent,
                offerType: item.offerType,
                offerName: item.offerName,
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
            subtotal,
            totalDiscount,
            shippingFee,
            finalAmount,
            paymentMethod,
            paymentStatus: paymentMethod === 'cod' ? 'pending' : 'completed',
            orderStatus: paymentMethod === 'cod' ? 'pending' : 'confirmed',
            paymentDetails: getPaymentDetails(paymentMethod, paymentDetails, finalAmount)
        });

        await order.save({ session });

        // Update cart
        await Cart.findOneAndUpdate(
            { user: userId, active: true },
            { active: false, lastActive: new Date() },
            { session }
        );

        await session.commitTransaction();

        res.status(200).json({
            success: true,
            message: 'Order placed successfully',
            orderId: order._id,
            orderNumber: order.orderNumber
        });

    } catch (error) {
        await session.abortTransaction();
        console.error('Order placement error:', error);
        res.status(400).json({
            success: false,
            message: error.message || 'Failed to place order'
        });
    } finally {
        session.endSession();
    }
};

const orderSuccess = async (req, res) => {
    try {
        const order = await Order.findById(req.params.orderId)
            .select('orderNumber finalAmount paymentMethod');

        if (!order) {
            throw new Error('Order not found');
        }

        res.render('orderSuccess', {
            order,
            storeName: process.env.STORE_NAME || 'Your Store Name'
        });
    } catch (error) {
        res.status(500).render('error', { 
            message: 'Something went wrong' 
        });
    }
};

// Helper Functions
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

async function generateOrderNumber() {
    const date = new Date();
    const year = date.getFullYear().toString().slice(-2);
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    
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

async function generateOrderId() {
    return new mongoose.Types.ObjectId().toString();
}

module.exports = {
    getCheckout,
    createRazorpayOrder,
    verifyRazorpayPayment,
    addCheckoutAddress,
    placeOrder,
    orderSuccess
};