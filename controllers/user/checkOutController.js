const Cart = require('../../models/cartSchema');
const User = require('../../models/userSchema');
const Address = require('../../models/addressSchema');
const Order = require('../../models/orderSchema');
const Product = require('../../models/productSchema');
const Wallet = require('../../models/walletSchema');
const Offer = require('../../models/offerSchema');
const Coupon = require('../../models/couponSchema');
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

        // Calculate initial totals
        const subtotal = processedItems.reduce((sum, item) => 
            sum + (item.price * item.quantity), 0);
            
        const totalDiscount = processedItems.reduce((sum, item) => 
            sum + ((item.price * item.quantity) - item.itemTotal), 0);

        // Handle coupon discount
        let couponDiscount = 0;
        let appliedCoupon = null;
        
        if (req.session.appliedCoupon) {
            // Verify coupon is still valid
            const coupon = await Coupon.findOne({
                _id: req.session.appliedCoupon._id,
                isActive: true,
                validFrom: { $lte: currentDate },
                validUntil: { $gte: currentDate }
            });

            if (coupon) {
                // Recalculate coupon discount based on current cart
                if (coupon.discountType === 'percentage') {
                    couponDiscount = (subtotal * coupon.discountValue) / 100;
                    if (coupon.maxDiscountAmount) {
                        couponDiscount = Math.min(couponDiscount, coupon.maxDiscountAmount);
                    }
                } else {
                    couponDiscount = coupon.discountValue;
                }

                // Verify minimum purchase requirement
                if (!coupon.minPurchaseAmount || subtotal >= coupon.minPurchaseAmount) {
                    appliedCoupon = {
                        code: coupon.code,
                        discountType: coupon.discountType,
                        discountValue: coupon.discountValue,
                        calculatedDiscount: couponDiscount,
                        _id: coupon._id
                    };
                } else {
                    // Remove coupon if minimum purchase is not met
                    delete req.session.appliedCoupon;
                }
            } else {
                // Remove invalid coupon
                delete req.session.appliedCoupon;
            }
        }

        const shippingFee = 128; // You might want to make this configurable
        const finalAmount = subtotal - totalDiscount - couponDiscount + shippingFee;

        // Prepare checkout data
        const checkoutData = {
            items: processedItems,
            subtotal,
            totalDiscount,
            couponDiscount,
            shippingFee,
            finalAmount
        };

        // Debug logging
        console.log('Checkout Summary:', {
            subtotal,
            totalDiscount,
            couponDiscount,
            shippingFee,
            finalAmount,
            appliedCoupon
        });

        res.render('checkout', {
            checkoutData,
            addresses,
            appliedCoupon,
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
            message: 'Failed to load checkout page',
            error: process.env.NODE_ENV === 'development' ? error : {}
        });
    }
};

const applyCoupon = async (req, res) => {
    try {
        const { couponCode } = req.body;
        const userId = req.user._id;
        
        const coupon = await Coupon.findOne({
            code: couponCode.toUpperCase(),
            isActive: true,
            validFrom: { $lte: new Date() },
            validUntil: { $gte: new Date() }
        });

        if (!coupon) {
            return res.status(400).json({
                success: false,
                message: 'Invalid or expired coupon code'
            });
        }

        const cart = await Cart.findOne({ 
            user: userId,
            active: true 
        }).populate('items.product');

        if (!cart || cart.items.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'No items in cart'
            });
        }

        const subtotal = cart.items.reduce((total, item) => {
            const itemPrice = item.discountedPrice || item.price;
            return total + (itemPrice * item.quantity);
        }, 0);

        if (coupon.minPurchaseAmount && subtotal < coupon.minPurchaseAmount) {
            return res.status(400).json({
                success: false,
                message: `Minimum purchase of ₹${coupon.minPurchaseAmount} required`
            });
        }

        // Check usage limit per user
        if (coupon.perUserLimit) {
            const userUsageCount = await Order.countDocuments({
                user: userId,
                'coupon.code': coupon.code
            });

            if (userUsageCount >= coupon.perUserLimit) {
                return res.status(400).json({
                    success: false,
                    message: 'You have exceeded the usage limit for this coupon'
                });
            }
        }

        // Calculate discount based on type
        let calculatedDiscount;
        if (coupon.discountType === 'percentage') {
            calculatedDiscount = (subtotal * coupon.discountValue) / 100;
            if (coupon.maxDiscountAmount) {
                calculatedDiscount = Math.min(calculatedDiscount, coupon.maxDiscountAmount);
            }
        } else {
            calculatedDiscount = Math.min(coupon.discountValue, subtotal);
        }

        // Store coupon in session
        req.session.appliedCoupon = {
            code: coupon.code,
            discountType: coupon.discountType,
            discountValue: coupon.discountValue,
            calculatedDiscount,
            _id: coupon._id
        };

        res.json({
            success: true,
            coupon: {
                code: coupon.code,
                discountType: coupon.discountType,
                discountValue: coupon.discountValue,
                calculatedDiscount
            },
            message: 'Coupon applied successfully'
        });

    } catch (error) {
        console.error('Error in applyCoupon:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to apply coupon'
        });
    }
};

const removeCoupon = async (req, res) => {
    try {
        // Remove coupon from session
        delete req.session.appliedCoupon;
        
        res.json({
            success: true,
            message: 'Coupon removed successfully'
        });
    } catch (error) {
        console.error('Error in removeCoupon:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to remove coupon'
        });
    }
};
const getAvailableCoupons = async (req, res) => {
    try {
        const currentDate = new Date();
        const cart = await Cart.findOne({ user: req.user._id, active: true })
            .populate('items.product');
            
        if (!cart || !cart.items.length) {
            return res.json({
                success: true,
                coupons: []
            });
        }

        const cartTotal = cart.items.reduce((sum, item) => 
            sum + (item.price * item.quantity), 0);
        
        // Fetch all active coupons
        const coupons = await Coupon.find({
            isActive: true,
            validFrom: { $lte: currentDate },
            validUntil: { $gte: currentDate },
            minPurchaseAmount: { $lte: cartTotal }
        }).lean();

        // Filter coupons based on usage limits
        const validCoupons = await Promise.all(coupons.map(async (coupon) => {
            // Check total usage limit
            if (coupon.usageLimit && coupon.usageCount >= coupon.usageLimit) {
                return null;
            }

            // Check per-user limit
            if (coupon.perUserLimit) {
                const userUsageCount = await Order.countDocuments({
                    user: req.user._id,
                    'coupon.code': coupon.code
                });
                
                if (userUsageCount >= coupon.perUserLimit) {
                    return null;
                }
            }

            return {
                ...coupon,
                discountValue: coupon.discountValue,
                minPurchaseAmount: coupon.minPurchaseAmount,
                maxDiscountAmount: coupon.maxDiscountAmount,
                validUntil: coupon.validUntil,
            };
        }));

        res.json({
            success: true,
            coupons: validCoupons.filter(Boolean)
        });

    } catch (error) {
        console.error('Error fetching available coupons:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch available coupons'
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

        // Update product stock and validate availability
        for (const item of items) {
            const product = await Product.findById(item.productId);
            if (!product) {
                throw new Error(`Product ${item.productName} not found`);
            }

            // Find the specific variant and size
            const variant = product.variants.find(v => 
                v.colorName === item.selectedColor.colorName
            );
            if (!variant) {
                throw new Error(`Color variant not found for ${item.productName}`);
            }

            const sizeVariant = variant.colorVariant.find(sv => 
                sv.size === item.selectedSize
            );
            if (!sizeVariant) {
                throw new Error(`Size variant not found for ${item.productName}`);
            }

            // Check if enough stock is available
            if (sizeVariant.stock < item.quantity) {
                throw new Error(`Insufficient stock for ${item.productName}`);
            }

            // Update stock using findOneAndUpdate to avoid validation issues
            await Product.findOneAndUpdate(
                {
                    _id: item.productId,
                    'variants.colorName': item.selectedColor.colorName,
                    'variants.colorVariant.size': item.selectedSize
                },
                {
                    $inc: {
                        'variants.$.colorVariant.$[size].stock': -item.quantity,
                        totalSales: item.quantity
                    }
                },
                {
                    arrayFilters: [{ 'size.size': item.selectedSize }],
                    new: true,
                    runValidators: false
                }
            );
        }

        // Calculate totals
        const subtotal = items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
        const totalDiscount = items.reduce((sum, item) => 
            sum + ((item.price * item.quantity) - item.itemTotal), 0);
        
        // Generate order identifiers
        const orderId = await Order.generateOrderId();
        const orderNumber = await Order.generateOrderNumber();

        // Handle coupon from session
        let couponData = null;
        if (req.session.appliedCoupon) {
            const coupon = await Coupon.findOne({
                _id: req.session.appliedCoupon._id,
                isActive: true,
                validFrom: { $lte: new Date() },
                validUntil: { $gte: new Date() }
            });

            if (coupon) {
                couponData = {
                    code: coupon.code,
                    discountAmount: req.session.appliedCoupon.calculatedDiscount,
                    discountType: coupon.discountType
                };

                // Update coupon usage count
                await Coupon.findByIdAndUpdate(coupon._id, {
                    $inc: { usageCount: 1 }
                });
            }
        }

        const shippingFee = 128;
        const totalAmount = subtotal - totalDiscount - (couponData?.discountAmount || 0);

        // Check wallet balance if payment method is wallet
        if (paymentMethod === 'wallet') {
            const wallet = await Wallet.findOne({ user: userId });
            if (!wallet || wallet.balance < totalAmount) {
                throw new Error('Insufficient wallet balance');
            }
        }

        // Create order first
        const order = new Order({
            orderId,
            orderNumber,
            user: userId,
            items: items.map(item => ({
                product: item.productId,
                productName: item.productName,
                productImage: item.productImage,
                selectedColor: {
                    colorName: item.selectedColor.colorName,
                    colorValue: item.selectedColor.colorValue
                },
                selectedSize: item.selectedSize,
                quantity: item.quantity,
                price: item.price,
                appliedProductOffer: item.discountPercent || 0,
                appliedCategoryOffer: 0,
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
            totalAmount,
            totalDiscount,
            shippingFee,
            paymentMethod,
            paymentStatus: paymentMethod === 'cod' ? 'pending' : 'completed',
            orderStatus: paymentMethod === 'cod' ? 'pending' : 'confirmed',
            coupon: couponData,
            statusHistory: [{
                status: paymentMethod === 'cod' ? 'pending' : 'confirmed',
                timestamp: new Date(),
                comment: `Order ${paymentMethod === 'cod' ? 'placed' : 'confirmed'} with ${paymentMethod} payment`
            }]
        });

        // Save order to get MongoDB _id
        await order.save();

        // Handle wallet payment after order creation
        if (paymentMethod === 'wallet') {
            const wallet = await Wallet.findOne({ user: userId });
            // Debit wallet using order._id instead of orderId
            await wallet.debit(
                totalAmount,
                `Order payment for #${orderNumber}`,
                order._id, // Using MongoDB _id instead of orderId string
                { reason: 'order_payment' }
            );

            // Update order with wallet details
            order.walletDetails = {
                transactionId: wallet.transactions[wallet.transactions.length - 1]._id,
                debitedAmount: totalAmount,
                debitedAt: new Date()
            };
            await order.save();
        }

        // Handle Razorpay payment details
        if (paymentMethod === 'razorpay' && paymentDetails) {
            order.paymentDetails = {
                razorpayOrderId: paymentDetails.razorpay_order_id,
                razorpayPaymentId: paymentDetails.razorpay_payment_id,
                razorpaySignature: paymentDetails.razorpay_signature,
                paidAmount: totalAmount,
                paidAt: new Date()
            };
            await order.save();
        }

        // Update cart status
        await Cart.findOneAndUpdate(
            { user: userId, active: true },
            { active: false, lastActive: new Date() }
        );

        // Clear applied coupon from session
        if (req.session.appliedCoupon) {
            delete req.session.appliedCoupon;
        }

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

const orderSuccess = async (req, res) => {
    try {
        // Find latest order if orderId is not provided
        let order;
        if (req.params.orderId) {
            order = await Order.findById(req.params.orderId)
                .select('orderNumber totalAmount paymentMethod paymentStatus orderStatus items shippingAddress user')
                .populate('user');
        } else {
            // If no orderId provided, find the latest order for the user
            order = await Order.findOne({ user: req.user._id })
                .sort({ createdAt: -1 })
                .select('orderNumber totalAmount paymentMethod paymentStatus orderStatus items shippingAddress user')
                .populate('user');
        }

        if (!order) {
            throw new Error('Order not found');
        }

        // Check if the order belongs to the logged-in user
        if (order.user._id.toString() !== req.user._id.toString()) {
            throw new Error('Unauthorized access');
        }

        res.render('orderSuccess', {
            order,
            storeName: process.env.STORE_NAME || 'Your Store Name'
        });
    } catch (error) {
        console.error('Order success page error:', error);
        res.status(error.message === 'Unauthorized access' ? 403 : 500)
            .render('error', { 
                message: error.message || 'Something went wrong'
            });
    }
};
// Helper Functions
function getPaymentDetails(paymentMethod, paymentDetails, totalAmount) {
    switch(paymentMethod) {
        case 'razorpay':
            return {
                razorpayPaymentId: paymentDetails?.razorpay_payment_id,
                razorpayOrderId: paymentDetails?.razorpay_order_id,
                razorpaySignature: paymentDetails?.razorpay_signature,
                paidAmount: totalAmount,
                paidAt: new Date()
            };
        case 'wallet':
            return {
                walletTransactionId: new mongoose.Types.ObjectId().toString(),
                paidAmount: totalAmount,
                paidAt: new Date()
            };
        case 'cod':
            return {
                codAmount: totalAmount
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
    orderSuccess,
    applyCoupon,
    removeCoupon,
    getAvailableCoupons

};