const mongoose = require('mongoose');
const slugify = require('slugify');

const categorySchema = new mongoose.Schema({
    name: {
        type: String,
        required: [true, 'Category name is required'],
        trim: true,
        minlength: [2, 'Category name must be at least 2 characters'],
        maxlength: [50, 'Category name cannot exceed 50 characters'],
        unique: true
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
        lowercase: true
    },
    isListed: {
        type: Boolean,
        default: true
    },
    categoryOffer: {
        type: Number,
        default: 0,
        min: [0, 'Offer cannot be negative'],
        max: [100, 'Offer cannot exceed 100%']
    }
}, {
    timestamps: true // Automatically manage createdAt and updatedAt
});

// Generate slug before saving
categorySchema.pre('save', function(next) {
    if (this.isModified('name')) {
        this.slug = slugify(this.name, {
            lower: true,
            strict: true
        });
    }
    next();
});


const Category = mongoose.model('Category', categorySchema);

module.exports = Category;