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
const moment = require('moment');

// Initialize Razorpay
const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET
});

const calculateItemTotals = (item, productOffer = 0, categoryOffer = 0) => {
    const originalPrice = item.price;
    const bestDiscountPercent = Math.max(productOffer, categoryOffer);
    const discountedPrice = originalPrice * (1 - bestDiscountPercent / 100);
    const itemTotal = discountedPrice * item.quantity;

    return {
        originalPrice,
        discountedPrice: Number(discountedPrice.toFixed(2)),
        discountPercent: bestDiscountPercent,
        itemTotal: Number(itemTotal.toFixed(2))
    };
};


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

            // Calculate best discount - take only the highest offer
            const productDiscountPercent = productOffer?.discountPercentage || 0;
            const categoryDiscountPercent = categoryOffer?.discountPercentage || 0;
            const bestDiscountPercent = Math.max(productDiscountPercent, categoryDiscountPercent);

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

        // Calculate totals consistently
        const subtotal = processedItems.reduce((sum, item) => 
            sum + (item.price * item.quantity), 0);
            
        const totalDiscount = processedItems.reduce((sum, item) => 
            sum + ((item.price * item.quantity) - item.itemTotal), 0);

        let couponDiscount = 0;
        let appliedCoupon = null;
        
        if (req.session.appliedCoupon) {
            const coupon = await Coupon.findOne({
                _id: req.session.appliedCoupon._id,
                isActive: true,
                validFrom: { $lte: currentDate },
                validUntil: { $gte: currentDate }
            });

            if (coupon) {
                if (coupon.discountType === 'percentage') {
                    couponDiscount = Math.min(
                        (subtotal * coupon.discountValue) / 100,
                        coupon.maxDiscountAmount || Infinity
                    );
                } else {
                    couponDiscount = Math.min(coupon.discountValue, subtotal);
                }

                if (!coupon.minPurchaseAmount || subtotal >= coupon.minPurchaseAmount) {
                    appliedCoupon = {
                        code: coupon.code,
                        discountType: coupon.discountType,
                        discountValue: coupon.discountValue,
                        calculatedDiscount: couponDiscount,
                        _id: coupon._id
                    };
                }
            }
        }

        const shippingFee = 128;
        const finalAmount = subtotal - totalDiscount - couponDiscount + shippingFee;

        const checkoutData = {
            items: processedItems,
            subtotal,
            totalDiscount,
            couponDiscount,
            shippingFee,
            finalAmount
        };

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

        // Validate required fields
        if (!addressId || !items || !paymentMethod) {
            throw new Error('Missing required order information');
        }

        // Validate address
        const address = await Address.findById(addressId);
        if (!address || address.userId.toString() !== userId.toString()) {
            throw new Error('Invalid delivery address');
        }

        // Validate products and stock
        const invalidItems = [];
        const productsToUpdate = [];

        for (const item of items) {
            const product = await Product.findById(item.productId);
            if (!product) {
                invalidItems.push(`Product ${item.productName} not found`);
                continue;
            }

            const variant = product.variants.find(v => 
                v.colorName === item.selectedColor.colorName
            );
            if (!variant) {
                invalidItems.push(`Color variant not found for ${item.productName}`);
                continue;
            }

            const sizeVariant = variant.colorVariant.find(sv => 
                sv.size === item.selectedSize
            );
            if (!sizeVariant) {
                invalidItems.push(`Size variant not found for ${item.productName}`);
                continue;
            }

            if (sizeVariant.stock < item.quantity) {
                invalidItems.push(`Insufficient stock for ${item.productName}`);
                continue;
            }

            productsToUpdate.push({
                product,
                variant,
                sizeVariant,
                quantity: item.quantity,
                item
            });
        }

        if (invalidItems.length > 0) {
            throw new Error(`Validation failed: ${invalidItems.join(', ')}`);
        }

        // Calculate order totals consistently
        const subtotal = items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
        const totalDiscount = items.reduce((sum, item) => 
            sum + ((item.price * item.quantity) - item.itemTotal), 0);

        // Handle coupon application
        let couponDiscount = 0;
        let couponData = null;

        if (req.session.appliedCoupon) {
            const coupon = await Coupon.findOne({
                _id: req.session.appliedCoupon._id,
                isActive: true,
                validFrom: { $lte: new Date() },
                validUntil: { $gte: new Date() }
            });

            if (coupon) {
                if (coupon.minPurchaseAmount && subtotal < coupon.minPurchaseAmount) {
                    throw new Error(`Minimum purchase amount of ₹${coupon.minPurchaseAmount} required for coupon`);
                }

                couponDiscount = Number(req.session.appliedCoupon.calculatedDiscount);
                couponData = {
                    code: coupon.code,
                    discountAmount: couponDiscount,
                    discountType: coupon.discountType
                };
            }
        }

        const shippingFee = 128;
        const finalAmount = Number((subtotal - totalDiscount - couponDiscount + shippingFee).toFixed(2));

       // In placeOrder function, modify the Razorpay failure section
       if (paymentMethod === 'razorpay' && paymentDetails && paymentDetails.payment_status === 'failed') {
        const [orderId, orderNumber] = await Promise.all([
            Order.generateOrderId(),
            Order.generateOrderNumber()
        ]);
    
        const failedOrder = new Order({
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
                status: 'active'  // Keep items active
            })),
            shippingAddress: {
                fullName: address.fullName,
                streetAddress: address.streetAddress,
                city: address.city,
                state: address.state,
                pincode: address.pincode,
                phoneNumber: address.phoneNumber
            },
            totalAmount: subtotal,
            totalDiscount,
            coupon: couponData,
            shippingFee,
            finalAmount,
            paymentMethod: 'razorpay',
            paymentStatus: 'failed',
            orderStatus: 'payment_failed',  // Set to payment_failed
            statusHistory: [{
                status: 'payment_failed',
                timestamp: new Date(),
                comment: `Payment failed${paymentDetails.error_description ? ': ' + paymentDetails.error_description : ''}`
            }]
        });
    
        await failedOrder.save();
    
        return res.status(200).json({
            success: true,
            message: 'Order status: Payment failed',
            orderId: failedOrder._id,
            orderNumber: failedOrder.orderNumber,
            paymentFailed: true
        });
    }

        // Validate payment method specific conditions
        if (paymentMethod === 'cod' && finalAmount > 1000) {  
            throw new Error('Cash on Delivery is only available for orders below ₹1,000');
        }

        if (paymentMethod === 'wallet') {
            const wallet = await Wallet.findOne({ user: userId });
            if (!wallet || wallet.balance < finalAmount) {
                throw new Error('Insufficient wallet balance');
            }
        }

        if (paymentMethod === 'razorpay' && (!paymentDetails || !paymentDetails.razorpay_payment_id)) {
            throw new Error('Invalid payment details');
        }

        // Generate order identifiers
        const [orderId, orderNumber] = await Promise.all([
            Order.generateOrderId(),
            Order.generateOrderNumber()
        ]);

        // Create successful order
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
            totalAmount: subtotal,
            totalDiscount,
            coupon: couponData,
            shippingFee,
            finalAmount,
            paymentMethod,
            paymentStatus: paymentMethod === 'cod' ? 'pending' : 'completed',
            orderStatus: paymentMethod === 'cod' ? 'pending' : 'confirmed',
            estimatedDelivery: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
            statusHistory: [{
                status: paymentMethod === 'cod' ? 'pending' : 'confirmed',
                timestamp: new Date(),
                comment: `Order ${paymentMethod === 'cod' ? 'placed' : 'confirmed'} with ${paymentMethod} payment`
            }]
        });

        // Set payment specific details
        if (paymentMethod === 'razorpay' && paymentDetails) {
            order.paymentDetails = {
                razorpayOrderId: paymentDetails.razorpay_order_id,
                razorpayPaymentId: paymentDetails.razorpay_payment_id,
                razorpaySignature: paymentDetails.razorpay_signature,
                paidAmount: finalAmount,
                paidAt: new Date()
            };
        }

        // Save order first
        await order.save();

        // Update product stock
        for (const { product, variant, sizeVariant, quantity } of productsToUpdate) {
            await Product.findOneAndUpdate(
                {
                    _id: product._id,
                    'variants.colorName': variant.colorName,
                    'variants.colorVariant.size': sizeVariant.size
                },
                {
                    $inc: {
                        'variants.$.colorVariant.$[size].stock': -quantity,
                        totalSales: quantity
                    }
                },
                {
                    arrayFilters: [{ 'size.size': sizeVariant.size }]
                }
            );
        }

        // Handle wallet payment
        if (paymentMethod === 'wallet') {
            const wallet = await Wallet.findOne({ user: userId });
            const debitTransaction = await wallet.debit(
                finalAmount,
                `Order payment for #${orderNumber}`,
                order._id,
                { reason: 'order_payment' }
            );

            order.walletDetails = {
                transactionId: debitTransaction._id,
                debitedAmount: finalAmount,
                debitedAt: new Date()
            };
            await order.save();
        }

        // Update coupon usage if applicable
        if (couponData) {
            await Coupon.findByIdAndUpdate(req.session.appliedCoupon._id, {
                $inc: { usageCount: 1 }
            });
        }

        // Mark cart as inactive
        await Cart.findOneAndUpdate(
            { user: userId, active: true },
            { 
                active: false, 
                lastActive: new Date() 
            }
        );

        // Clear coupon from session
        if (req.session.appliedCoupon) {
            delete req.session.appliedCoupon;
        }

        res.status(200).json({
            success: true,
            message: 'Order placed successfully',
            orderId: order._id,
            orderNumber: order.orderNumber,
            paymentFailed: false
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
        const select = `
            orderNumber totalAmount paymentMethod paymentStatus orderStatus 
            items shippingAddress user createdAt estimatedDelivery coupon 
            totalDiscount shippingFee finalAmount trackingDetails paymentDetails statusHistory
        `;

        const order = await Order.findById(req.params.orderId)
            .select(select)
            .populate('items.product')
            .populate('user');

        if (!order) {
            throw new Error('Order not found');
        }

        // Verify order belongs to logged-in user
        if (order.user._id.toString() !== req.user._id.toString()) {
            throw new Error('Unauthorized access');
        }

        // Calculate all order totals
        const orderTotals = {
            itemsTotal: order.items.reduce((sum, item) => {
                const price = Number(item.price) || 0;
                const quantity = Number(item.quantity) || 0;
                return sum + (price * quantity);
            }, 0),
            offerSavings: order.items.reduce((acc, item) => {
                const price = Number(item.price) || 0;
                const quantity = Number(item.quantity) || 0;
                const originalPrice = price * quantity;
                const itemTotal = Number(item.itemTotal) || 0;
                return acc + (originalPrice - itemTotal);
            }, 0),
            couponDiscount: order.coupon?.discountAmount || 0,
            shippingFee: Number(order.shippingFee) || 0
        };

        // Format totals
        const totals = {
            totalItemsPrice: Number(orderTotals.itemsTotal.toFixed(2)),
            offerSavings: Number(orderTotals.offerSavings.toFixed(2)),
            couponDiscount: Number(orderTotals.couponDiscount.toFixed(2)),
            shippingFee: Number(orderTotals.shippingFee.toFixed(2)),
            finalAmount: Number(order.finalAmount.toFixed(2))
        };

        // Get failure reason safely
        let failureReason = null;
        if (order.statusHistory && Array.isArray(order.statusHistory)) {
            const failedStatus = order.statusHistory.find(s => 
                s.status === 'cancelled' || s.status === 'payment_failed'
            );
            failureReason = failedStatus?.comment;
        }

        // Get payment details and status
        const paymentInfo = {
            method: order.paymentMethod,
            status: order.paymentStatus,
            statusText: getPaymentStatusText(order.paymentStatus),
            methodText: getPaymentMethodText(order.paymentMethod),
            details: order.paymentDetails || {},
            failureReason: failureReason
        };

        // Get shipping status
        const shippingInfo = {
            status: order.orderStatus,
            statusText: getOrderStatusText(order.orderStatus),
            estimatedDelivery: order.estimatedDelivery,
            address: order.shippingAddress,
            tracking: order.trackingDetails || {}
        };

        // Format currency helper
        const formatAmount = (amount) => {
            const safeAmount = Number(amount) || 0;
            return safeAmount.toLocaleString('en-IN', {
                maximumFractionDigits: 2,
                minimumFractionDigits: 2
            });
        };

        // Format date helper
        const formatDate = (date) => {
            return moment(date).format('MMM DD, YYYY, hh:mm A');
        };

        res.render('orderSuccess', {
            order,
            totals,
            paymentInfo,
            shippingInfo,
            formatAmount,
            formatDate,
            storeName: process.env.STORE_NAME || 'Your Store Name',
            moment: require('moment')
        });

    } catch (error) {
        console.error('Order success page error:', error);
        res.status(error.message === 'Unauthorized access' ? 403 : 500)
            .render('error', { 
                message: error.message || 'Something went wrong',
                error: process.env.NODE_ENV === 'development' ? error : {}
            });
    }
};

function getPaymentStatusText(status) {
    const statusMap = {
        'pending': 'Payment Pending',
        'completed': 'Payment Completed',
        'failed': 'Payment Failed',
        'refunded': 'Payment Refunded',
        'partially_refunded': 'Partially Refunded'
    };
    return statusMap[status] || status;
}

function getOrderStatusText(status) {
    const statusMap = {
        'pending': 'Order Pending',
        'confirmed': 'Order Confirmed',
        'processing': 'Processing',
        'shipped': 'Shipped',
        'delivered': 'Delivered',
        'cancelled': 'Cancelled',
        'returned': 'Returned',
        'partially_cancelled': 'Partially Cancelled',
        'partially_returned': 'Partially Returned',
        'payment_failed': 'Payment Failed'
    };
    return statusMap[status] || status;
}

function getPaymentMethodText(method) {
    const methodMap = {
        'cod': 'Cash on Delivery',
        'razorpay': 'Online Payment',
        'wallet': 'Wallet Payment'
    };
    return methodMap[method] || method;
}


function getOrderStatusText(status) {
    const statusMap = {
        'pending': 'Order Pending',
        'confirmed': 'Order Confirmed',
        'processing': 'Processing',
        'shipped': 'Shipped',
        'delivered': 'Delivered',
        'cancelled': 'Cancelled',
        'returned': 'Returned',
        'partially_cancelled': 'Partially Cancelled',
        'partially_returned': 'Partially Returned'
    };
    return statusMap[status] || status;
}


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
    getAvailableCoupons,
    getPaymentStatusText,
    getPaymentMethodText,
    getOrderStatusText,
  

};