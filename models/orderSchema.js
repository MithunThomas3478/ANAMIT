const mongoose = require('mongoose');
const { Schema } = mongoose;

// Order Item Schema
const orderItemSchema = new Schema({
    product: {
        type: Schema.Types.ObjectId,
        ref: 'Product',
        required: true
    },
    productImage: {
        type: String,
        required: false,
        get: function(image) {
            return image ? image : null;
        }
    },
    productName: {
        type: String,
        required: true
    },
    selectedColor: {
        colorName: {
            type: String,
            required: true
        },
        colorValue: String
    },
    selectedSize: {
        type: String,
        enum: ['XS', 'S', 'M', 'L', 'XL', 'XXL'],
        required: true
    },
    quantity: {
        type: Number,
        required: true,
        min: 1
    },
    price: {
        type: Number,
        required: true,
        min: 0
    },
    appliedProductOffer: {
        type: Number,
        default: 0,
        min: 0,
        max: 100
    },
    appliedCategoryOffer: {
        type: Number,
        default: 0,
        min: 0,
        max: 100
    },
    itemTotal: {
        type: Number,
        required: true
    },
    status: {
        type: String,
        enum: ['active', 'cancelled', 'returned', 'return_pending', 'return_rejected'],
        default: 'active'
    },
    cancellationDetails: {
        cancelledAt: Date,
        reason: String,
        refundAmount: Number,
        refundStatus: {
            type: String,
            enum: ['not_applicable', 'pending', 'processed', 'completed'],
            default: 'not_applicable'
        },
        processedAt: Date,
        walletTransactionId: String
    },
    returnDetails: {
        requestedAt: Date,
        reason: String,
        condition: {
            type: String,
            enum: ['unopened', 'opened_unused', 'used', 'damaged']
        },
        status: {
            type: String,
            enum: ['pending', 'approved', 'rejected', 'completed']
        },
        refundAmount: Number,
        refundStatus: {
            type: String,
            enum: ['not_applicable', 'pending', 'processed', 'completed'],
            default: 'not_applicable'
        },
        processedAt: Date,
        walletTransactionId: String,
        comments: String
    }
});

// Order Schema
const orderSchema = new Schema({
    orderId: {
        type: String,
        required: true,
        unique: true
    },
    orderNumber: {
        type: String,
        required: true,
        unique: true
    },
    user: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    items: [orderItemSchema],
    shippingAddress: {
        fullName: String,
        streetAddress: String,
        city: String,
        state: String,
        pincode: String,
        phoneNumber: String
    },
    totalAmount: {
        type: Number,
        required: true,
        min: 0
    },
    totalDiscount: {
        type: Number,
        default: 0,
        min: 0
    },
    shippingFee: {
        type: Number,
        default: 128,
        min: 0
    },
    paymentMethod: {
        type: String,
        enum: ['cod', 'razorpay', 'wallet'],
        required: true
    },
    paymentStatus: {
        type: String,
        enum: ['pending', 'completed', 'failed', 'refunded', 'partially_refunded'],
        default: 'pending'
    },
    walletDetails: {
        transactionId: String,
        debitedAmount: Number,
        debitedAt: Date
    },
    paymentDetails: {
        razorpayOrderId: String,
        razorpayPaymentId: String,
        razorpaySignature: String,
        paidAmount: Number,
        paidAt: Date,
        walletTransactionId: String
    },
    orderStatus: {
        type: String,
        enum: ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled', 'returned', 'partially_cancelled', 'partially_returned'],
        default: 'pending'
    },
    statusHistory: [{
        status: {
            type: String,
            enum: ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled', 'returned', 'partially_cancelled', 'partially_returned']
        },
        timestamp: {
            type: Date,
            default: Date.now
        },
        comment: String
    }],
    trackingDetails: {
        courier: String,
        trackingNumber: String,
        trackingUrl: String
    },
    estimatedDelivery: Date,
    actualDelivery: Date,
    coupon: {
        code: {
            type: String,
            trim: true,
            uppercase: true
        },
        discountAmount: {
            type: Number,
            min: 0
        },
        discountType: {
            type: String,
            enum: ['percentage', 'fixed']
        }
    }
}, {
    timestamps: true
});

// Order Item Methods
orderItemSchema.methods.canBeCancelled = function() {
    const order = this.parent();
    if (!order) return false;

    const nonCancellableStatuses = ['shipped', 'delivered', 'cancelled', 'returned'];
    return this.status === 'active' && !nonCancellableStatuses.includes(order.orderStatus);
};

orderItemSchema.methods.canBeReturned = function() {
    const order = this.parent();
    if (!order) return false;

    if (this.status !== 'active' || order.orderStatus !== 'delivered') return false;

    const deliveredDate = order.statusHistory.find(h => h.status === 'delivered')?.timestamp;
    if (!deliveredDate) return false;

    const returnWindow = 7 * 24 * 60 * 60 * 1000; // 7 days in milliseconds
    return (Date.now() - deliveredDate.getTime()) <= returnWindow;
};

orderItemSchema.methods.calculateRefundAmount = function() {
    let refundAmount = this.itemTotal;
    const order = this.parent();
    
    if (order.coupon && order.coupon.discountAmount) {
        const itemRatio = this.itemTotal / order.totalAmount;
        const itemDiscount = order.coupon.discountAmount * itemRatio;
        refundAmount -= itemDiscount;
    }

    return Math.max(0, refundAmount);
};

// Order Methods
orderSchema.methods.getActiveItems = function() {
    return this.items.filter(item => item.status === 'active');
};

orderSchema.methods.getCancelledItems = function() {
    return this.items.filter(item => item.status === 'cancelled');
};

orderSchema.methods.getReturnedItems = function() {
    return this.items.filter(item => item.status === 'returned');
};

orderSchema.methods.getActiveItemsTotal = function() {
    return this.getActiveItems().reduce((total, item) => total + item.itemTotal, 0);
};

orderSchema.methods.needsRefund = function(item) {
    return (this.paymentMethod === 'razorpay' || this.paymentMethod === 'wallet') &&
           this.paymentStatus === 'completed' &&
           (item.status === 'cancelled' || item.status === 'returned') &&
           item.cancellationDetails?.refundStatus !== 'completed';
};

orderSchema.methods.updateOrderStatus = function() {
    const activeItems = this.getActiveItems();
    const cancelledItems = this.getCancelledItems();
    const returnedItems = this.getReturnedItems();
    
    if (activeItems.length === 0) {
        if (cancelledItems.length === this.items.length) {
            this.orderStatus = 'cancelled';
        } else if (returnedItems.length === this.items.length) {
            this.orderStatus = 'returned';
        }
    } else {
        if (cancelledItems.length > 0) {
            this.orderStatus = 'partially_cancelled';
        } else if (returnedItems.length > 0) {
            this.orderStatus = 'partially_returned';
        }
    }
};

// Virtual for calculating final amount
orderSchema.virtual('finalAmount').get(function() {
    const activeItemsTotal = this.getActiveItemsTotal();
    const activeItemsRatio = activeItemsTotal / this.totalAmount;
    const applicableDiscount = this.totalDiscount * activeItemsRatio;
    
    return activeItemsTotal - applicableDiscount + this.shippingFee;
});

// Pre-save middleware
orderSchema.pre('save', function(next) {
    // Update order status based on items
    this.updateOrderStatus();

    // Add to status history if status changed
    if (this.isModified('orderStatus')) {
        this.statusHistory.push({
            status: this.orderStatus,
            timestamp: new Date(),
            comment: `Order status updated to ${this.orderStatus}`
        });
    }

    // Handle payment status changes
    if (this.isModified('paymentStatus') && this.paymentStatus === 'failed') {
        this.orderStatus = 'cancelled';
        this.items.forEach(item => {
            item.status = 'cancelled';
            item.cancellationDetails = {
                cancelledAt: new Date(),
                reason: 'Payment failed',
                refundStatus: 'not_applicable'
            };
        });
    }

    next();
});

// Generate order number
orderSchema.statics.generateOrderNumber = async function() {
    const date = new Date();
    const prefix = 'ORD' + date.getFullYear().toString().substr(-2) +
                  (date.getMonth() + 1).toString().padStart(2, '0');
    
    const lastOrder = await this.findOne({}, {}, { sort: { 'createdAt': -1 } });
    let sequence = 1;
    
    if (lastOrder && lastOrder.orderNumber) {
        const lastSequence = parseInt(lastOrder.orderNumber.slice(-4));
        sequence = lastSequence + 1;
    }
    
    return `${prefix}${sequence.toString().padStart(4, '0')}`;
};

// Generate orderId
orderSchema.statics.generateOrderId = async function() {
    const lastOrder = await this.findOne({}, {}, { sort: { 'createdAt': -1 } });
    let sequence = 1;
    
    if (lastOrder && lastOrder.orderId) {
        const lastSequence = parseInt(lastOrder.orderId.slice(-4));
        sequence = lastSequence + 1;
    }
    
    return `ORD-${sequence.toString().padStart(4, '0')}`;
};

// Initialize orderId if not present
orderSchema.pre('save', function(next) {
    if (!this.orderId) {
        this.constructor.generateOrderId().then(orderId => {
            this.orderId = orderId;
            next();
        });
    } else {
        next();
    }
});

const Order = mongoose.model('Order', orderSchema);
module.exports = Order;