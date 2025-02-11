const mongoose = require('mongoose');
const { Schema } = mongoose;

const offerSchema = new Schema({
    name: {
        type: String,
        required: [true, 'Offer name is required'],
        trim: true,
        unique: true
    },
    offerType: {
        type: String,
        enum: ['category', 'product'],
        required: [true, 'Offer type is required']
    },
    category: {
        type: Schema.Types.ObjectId,
        ref: 'Category',
        required: function () { return this.offerType === 'category'; }
    },
    product: {
        type: Schema.Types.ObjectId,
        ref: 'Product',
        required: function () { return this.offerType === 'product'; }
    },
    discountPercentage: {
        type: Number,
        required: [true, 'Discount percentage is required'],
        min: [0, 'Discount cannot be negative'],
        max: [100, 'Discount cannot exceed 100%']
    },
    startDate: {
        type: Date,
        required: [true, 'Start date is required'],
        validate: {
            validator: function(value) {
                // Skip validation during status toggle
                if (this.bypassStartDateValidation) return true;
                
                // Normalize dates for comparison
                const startDate = new Date(value);
                startDate.setHours(0, 0, 0, 0);
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                return startDate >= today;
            },
            message: 'Start date cannot be in the past'
        }
    },
    endDate: {
        type: Date,
        required: [true, 'End date is required'],
        validate: {
            validator: function(value) {
                if (!this.startDate) return true;
                
                // Normalize dates for comparison
                const startDate = new Date(this.startDate);
                startDate.setHours(0, 0, 0, 0);
                const endDate = new Date(value);
                endDate.setHours(23, 59, 59, 999);
                
                return endDate.getTime() >= startDate.getTime();
            },
            message: 'End date must be after start date'
        }
    },
    isActive: {
        type: Boolean,
        default: true
    }
}, {
    timestamps: true
});

// Add pre-save middleware to normalize dates
offerSchema.pre('save', function(next) {
    if (this.startDate) {
        const startDate = new Date(this.startDate);
        startDate.setHours(0, 0, 0, 0);
        this.startDate = startDate;
    }
    
    if (this.endDate) {
        const endDate = new Date(this.endDate);
        endDate.setHours(23, 59, 59, 999);
        this.endDate = endDate;
    }
    next();
});

// Add pre-update middleware to handle date normalization during updates
offerSchema.pre(['updateOne', 'findOneAndUpdate'], function(next) {
    const update = this.getUpdate();
    
    if (update.startDate) {
        const startDate = new Date(update.startDate);
        startDate.setHours(0, 0, 0, 0);
        update.startDate = startDate;
    }
    
    if (update.endDate) {
        const endDate = new Date(update.endDate);
        endDate.setHours(23, 59, 59, 999);
        update.endDate = endDate;
    }
    next();
});

const Offer = mongoose.model('Offer', offerSchema);
module.exports = Offer;