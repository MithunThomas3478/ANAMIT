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
        enum: ['cancelled', 'returned', 'return_pending', 'active'],
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

const paymentFailureDetailsSchema = {
    failureReason: String,
    failureCode: String,
    failureMessage: String,
    failedAt: Date,
    retryCount: {
        type: Number,
        default: 0
    },
    lastRetryAt: Date
};

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
        walletTransactionId: String,
        failureDetails: paymentFailureDetailsSchema  // Add this
    },
    orderStatus: {
        type: String,
        enum: ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 
               'cancelled', 'returned', 'partially_cancelled', 'partially_returned', 
               'payment_failed'],  // Add payment_failed status
        default: 'pending'
    },
    statusHistory: [{
        status: {
            type: String,
            enum: ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 
                   'cancelled', 'returned', 'partially_cancelled', 'partially_returned', 
                   'payment_failed']  // Add payment_failed status here too
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
    const order = this.parent();
    
    // Calculate the proportion of this item in the total order
    const itemRatio = this.itemTotal / order.totalAmount;
    
    // Calculate refund amount including proportional shipping fee
    let refundAmount = this.itemTotal;
    
    // Proportionally add shipping fee
    const proportionalShippingFee = order.shippingFee * itemRatio;
    refundAmount += proportionalShippingFee;
    
    // Subtract proportional coupon discount if applicable
    if (order.coupon && order.coupon.discountAmount) {
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

// Update the updateOrderStatus method in orderSchema

orderSchema.methods.updateOrderStatus = function(forceUpdate = false) {
    // Skip if orderStatus is already modified, unless forceUpdate is true
    if (this.isModified('orderStatus') && !forceUpdate) {
        return;
    }
    
    const activeItems = this.getActiveItems();
    const cancelledItems = this.getCancelledItems();
    const returnedItems = this.getReturnedItems();
    const returnPendingItems = this.items.filter(item => item.status === 'return_pending');
    
    // If there are no active items left
    if (activeItems.length === 0) {
        if (cancelledItems.length === this.items.length) {
            this.orderStatus = 'cancelled';
        } else if (returnedItems.length === this.items.length) {
            this.orderStatus = 'returned';
        } else if (returnPendingItems.length > 0) {
            // If some items are pending return approval
            this.orderStatus = 'processing';
        } else if (returnedItems.length > 0 && cancelledItems.length > 0) {
            // Mix of returned and cancelled items
            this.orderStatus = 'partially_returned';
        }
    } 
    // If there are still active items
    else {
        // IMPORTANT FIX: If the order was marked as delivered, keep it as delivered
        // This is crucial for showing the "Return Item" buttons for active items
        if (this.orderStatus === 'delivered') {
            // Only change from 'delivered' if there are returned items, not just pending returns
            if (returnedItems.length > 0) {
                this.orderStatus = 'partially_returned';
            }
            // Keep as 'delivered' otherwise
        }
        // For other statuses
        else if (cancelledItems.length > 0) {
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
    
    // Only add shipping if all items are active
    const shipping = this.items.every(item => item.status === 'active') ? this.shippingFee : 0;
    
    return activeItemsTotal - applicableDiscount + shipping;
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
        this.orderStatus = 'payment_failed';  // Change to payment_failed instead of cancelled
        this.items.forEach(item => {
            item.status = 'active';  // Keep items active
            // Remove cancellation details since we're not cancelling
            item.cancellationDetails = undefined;
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

orderSchema.methods.isDelivered = function() {
    return this.orderStatus === 'delivered';
};

orderSchema.methods.getDeliveryDate = function() {
    const deliveryEntry = this.statusHistory
        .filter(status => status.status === 'delivered')
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))[0];
    
    return deliveryEntry ? new Date(deliveryEntry.timestamp) : null;
};

orderSchema.methods.getRemainingReturnDays = function() {
    const deliveryDate = this.getDeliveryDate();
    if (!deliveryDate) return 0;
    
    const currentDate = new Date();
    const daysSinceDelivery = Math.floor(
        (currentDate - deliveryDate) / (1000 * 60 * 60 * 24)
    );
    
    return Math.max(0, 7 - daysSinceDelivery);
};

const Order = mongoose.model('Order', orderSchema);
module.exports = Order;