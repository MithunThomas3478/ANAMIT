const mongoose = require('mongoose');
const { Schema } = mongoose;

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
    productName: {  // Store name at time of order
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
        enum: ['active', 'cancelled'],
        default: 'active'
    },
    cancellationDetails: {
        cancelledAt: Date,
        reason: String,
        refundAmount: Number
    }
});

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
        enum: ['pending', 'completed', 'failed', 'refunded'],
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
        walletTransactionId: String  // Reference to wallet transaction if partial payment made through wallet
    },
    orderStatus: {
        type: String,
        enum: ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled', 'returned'],
        default: 'pending'
    },
    statusHistory: [{
        status: {
            type: String,
            enum: ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled', 'returned']
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
    cancelDetails: {
        reason: String,
        cancelledAt: Date,
        cancelledBy: {
            type: String,
            enum: ['user', 'admin', 'system']
        },
        refundStatus: {
            type: String,
            enum: ['not_applicable', 'pending', 'processed', 'completed'],
            default: 'not_applicable'
        }
    },
    returnDetails: {
        reason: String,
        requestedAt: Date,
        status: {
            type: String,
            enum: ['pending', 'approved', 'rejected', 'completed'],
        },
        refundStatus: {
            type: String,
            enum: ['not_applicable', 'pending', 'processed', 'completed'],
            default: 'not_applicable'
        }
    }
}, {
    timestamps: true
});


// Virtual for calculating final payable amount
orderSchema.virtual('finalAmount').get(function() {
    return this.totalAmount - this.totalDiscount + this.shippingFee;
});

// Pre-save middleware to handle status changes
orderSchema.pre('save', function(next) {
    // Add to status history if status changed
    if (this.isModified('orderStatus')) {
        this.statusHistory.push({
            status: this.orderStatus,
            timestamp: new Date(),
            comment: `Order status updated to ${this.orderStatus}`
        });
    }

    // Handle payment status changes
    if (this.isModified('paymentStatus')) {
        if (this.paymentStatus === 'completed') {
            this.orderStatus = 'confirmed';
        } else if (this.paymentStatus === 'failed') {
            this.orderStatus = 'cancelled';
            this.cancelDetails = {
                reason: 'Payment failed',
                cancelledAt: new Date(),
                cancelledBy: 'system',
                refundStatus: 'not_applicable'
            };
        }
    }

    if (!this.orderId) {
        this.constructor.generateOrderId().then(orderId => {
            this.orderId = orderId;
            next();
        });
    } else {
        next();
    }
});

// Method to generate order number
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

// Method to generate orderId
orderSchema.statics.generateOrderId = async function() {
    const lastOrder = await this.findOne({}, {}, { sort: { 'createdAt': -1 } });
    let sequence = 1;
    
    if (lastOrder && lastOrder.orderId) {
        const lastSequence = parseInt(lastOrder.orderId.slice(-4));
        sequence = lastSequence + 1;
    }
    
    return `ORD-${sequence.toString().padStart(4, '0')}`;
};

// Method to check if order can be cancelled
orderSchema.methods.canBeCancelled = function() {
    const nonCancellableStatuses = ['shipped', 'delivered', 'cancelled', 'returned'];
    return !nonCancellableStatuses.includes(this.orderStatus);
};

// Add this to your Order schema methods
orderSchema.methods.canBeCancelled = function() {
    console.log('Current order status:', this.orderStatus);
    const nonCancellableStatuses = ['shipped', 'delivered', 'cancelled', 'returned'];
    const cancellable = !nonCancellableStatuses.includes(this.orderStatus);
    console.log('Can be cancelled:', cancellable);
    return cancellable;
};

// Method to check if order can be returned
orderSchema.methods.canBeReturned = function() {
    if (this.orderStatus !== 'delivered') return false;
    
    const deliveredDate = this.statusHistory.find(h => h.status === 'delivered')?.timestamp;
    if (!deliveredDate) return false;
    
    // Can be returned within 7 days of delivery
    const returnWindow = 7 * 24 * 60 * 60 * 1000; // 7 days in milliseconds
    return (Date.now() - deliveredDate.getTime()) <= returnWindow;
};

// Pre-save middleware to initialize orderId
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