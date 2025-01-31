const mongoose = require('mongoose');
const { Schema } = mongoose;

const wishlistSchema = new Schema({
    user: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: [true, 'User reference is required'],
        unique: true 
    },
    items: [{
        product: {
            type: Schema.Types.ObjectId,
            ref: 'Product',
            required: [true, 'Product reference is required']
        },

        selectedVariant: {
            colorName: {
                type: String,
                trim: true,
                required: false
            },
            size: {
                type: String,
                enum: ['XS', 'S', 'M', 'L', 'XL', 'XXL'],
                required: false
            }
        },
        addedAt: {
            type: Date,
            default: Date.now
        },
        productSnapshot: {
            productName: String,
            slug: String,
            brand: String,
            thumbnail: String,
            price: Number,
            comparePrice: Number,
            productOffer: Number
        }
    }],
    lastModified: {
        type: Date,
        default: Date.now
    }
}, {
    timestamps: true
});

// Index for faster lookups
wishlistSchema.index({ 'user': 1, 'items.product': 1 });

// Limit maximum items in wishlist
wishlistSchema.path('items').validate(function(items) {
    return items.length <= 100; // Adjust max items as needed
}, 'Wishlist cannot contain more than 100 items');

// Method to check if a product exists in wishlist
wishlistSchema.methods.hasProduct = function(productId) {
    return this.items.some(item => item.product.equals(productId));
};

// Method to add product to wishlist
wishlistSchema.methods.addProduct = async function(product, selectedVariant = null) {
    if (this.hasProduct(product._id)) {
        return false;
    }

    // Get the price based on selected variant if provided
    let price = null;
    let comparePrice = null;
    if (selectedVariant) {
        const variant = product.variants.find(v => v.colorName === selectedVariant.colorName);
        if (variant) {
            const sizeVariant = variant.colorVariant.find(sv => sv.size === selectedVariant.size);
            if (sizeVariant) {
                price = sizeVariant.price;
                comparePrice = sizeVariant.comparePrice;
            }
        }
    }

    // If no variant selected or found, use price range minimum
    if (!price) {
        const priceRange = product.priceRange;
        price = priceRange.min;
    }

    this.items.push({
        product: product._id,
        selectedVariant,
        productSnapshot: {
            productName: product.productName,
            slug: product.slug,
            brand: product.brand,
            thumbnail: product.variants[0]?.productImage[0], // First image of first variant
            price,
            comparePrice,
            productOffer: product.productOffer
        }
    });

    this.lastModified = new Date();
    return true;
};

// Method to remove product from wishlist
wishlistSchema.methods.removeProduct = function(productId) {
    const initialLength = this.items.length;
    this.items = this.items.filter(item => !item.product.equals(productId));
    this.lastModified = new Date();
    return initialLength !== this.items.length;
};

// Virtual for calculating current prices with offers
wishlistSchema.virtual('currentPrices').get(function() {
    return this.items.map(item => ({
        productId: item.product,
        originalPrice: item.productSnapshot.price,
        currentPrice: item.productSnapshot.price * (1 - (item.productSnapshot.productOffer / 100))
    }));
});

module.exports = mongoose.model('Wishlist', wishlistSchema);