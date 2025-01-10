const mongoose = require('mongoose');

const categorySchema = new mongoose.Schema({
    name: {
        type: String,
        required: [true, 'Category name is required'],
        trim: true,
        minlength: [2, 'Category name must be at least 2 characters'],
        maxlength: [50, 'Category name cannot exceed 50 characters']
    },
    description: {
        type: String,
        required: [true, 'Description is required'],
        trim: true,
        minlength: [10, 'Description must be at least 10 characters'],
        maxlength: [500, 'Description cannot exceed 500 characters']
    },
    slug: {
        type: String,
        unique: true,
        required: true,
        trim: true,
        lowercase: true
    },
    isListed: {
        type: Boolean,
        default: true
    },
    createdAt: {
        type: Date,
        default: Date.now,
        immutable: true
    },
    updatedAt: {
        type: Date,
        default: Date.now
    },
    categoryOffer: {
        type: Number,
        default: 0,
        min: [0, 'Offer cannot be negative'],
        max: [100, 'Offer cannot exceed 100%']
    },
    productOffer: {
        type: Number,
        default: 0,
        min: [0, 'Offer cannot be negative'],
        max: [100, 'Offer cannot exceed 100%']
    }
});

// Add updatedAt middleware
categorySchema.pre('save', function(next) {
    this.updatedAt = new Date();
    next();
});

categorySchema.index({ name: 1 });

const Category = mongoose.model('Category', categorySchema);

module.exports = Category;