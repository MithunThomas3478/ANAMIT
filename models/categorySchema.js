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
    },
    parent: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Category',
        default: null
    },
    subcategories: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Category'
    }],
    level: {
        type: Number,
        default: 0
    },
    hasProducts: {
        type: Boolean,
        default: false
    },
    productCount: {
        type: Number,
        default: 0
    }
}, {
    timestamps: true
});

// Indexes for better query performance
categorySchema.index({ parent: 1, name: 1 }, { unique: true });
categorySchema.index({ slug: 1 }, { unique: true });
categorySchema.index({ level: 1 });
categorySchema.index({ isListed: 1 });

// Generate slug before saving
categorySchema.pre('save', async function(next) {
    try {
        if (this.isModified('name')) {
            this.slug = slugify(this.name, {
                lower: true,
                strict: true,
                remove: /[*+~.()'"!:@]/g
            });
        }

        if (this.isModified('parent') && this.parent) {
            const parentCategory = await mongoose.model('Category').findById(this.parent);
            if (parentCategory) {
                this.level = parentCategory.level + 1;
                
                if (!parentCategory.subcategories.includes(this._id)) {
                    parentCategory.subcategories.push(this._id);
                    await parentCategory.save();
                }

                if (this.level >= 3) {
                    throw new Error('Maximum category nesting level exceeded');
                }
            }
        }

        next();
    } catch (error) {
        next(error);
    }
});

// Remove from parent's subcategories before removing
categorySchema.pre('remove', async function(next) {
    try {
        if (this.parent) {
            const parentCategory = await mongoose.model('Category').findById(this.parent);
            if (parentCategory) {
                parentCategory.subcategories = parentCategory.subcategories.filter(
                    subId => !subId.equals(this._id)
                );
                await parentCategory.save();
            }
        }
        
        const subcategories = await mongoose.model('Category').find({ parent: this._id });
        for (const subcat of subcategories) {
            await subcat.remove();
        }
        
        next();
    } catch (error) {
        next(error);
    }
});

// Instance methods
categorySchema.methods.getAncestry = async function() {
    const ancestry = [];
    let currentCategory = this;
    
    while (currentCategory.parent) {
        currentCategory = await mongoose.model('Category').findById(currentCategory.parent);
        if (!currentCategory) break;
        ancestry.unshift(currentCategory);
    }
    
    return ancestry;
};

categorySchema.methods.getAllSubcategories = async function() {
    const subcategories = [];
    const queue = [...this.subcategories];
    
    while (queue.length) {
        const subCatId = queue.shift();
        const subCat = await mongoose.model('Category').findById(subCatId);
        if (subCat) {
            subcategories.push(subCat);
            queue.push(...subCat.subcategories);
        }
    }
    
    return subcategories;
};

categorySchema.statics.getFullHierarchy = async function() {
    const rootCategories = await this.find({ parent: null })
        .populate({
            path: 'subcategories',
            populate: { path: 'subcategories' }
        });
    return rootCategories;
};

categorySchema.methods.updateProductCount = async function(count) {
    this.productCount = count;
    this.hasProducts = count > 0;
    await this.save();
    
    if (this.parent) {
        const parentCategory = await mongoose.model('Category').findById(this.parent);
        if (parentCategory) {
            const parentProductCount = await mongoose.model('Product').countDocuments({
                category: { $in: [parentCategory._id, ...parentCategory.subcategories] }
            });
            await parentCategory.updateProductCount(parentProductCount);
        }
    }
};

categorySchema.virtual('fullPath').get(async function() {
    const ancestry = await this.getAncestry();
    const pathNames = ancestry.map(cat => cat.name);
    pathNames.push(this.name);
    return pathNames.join(' > ');
});

categorySchema.methods.canBeDeleted = async function() {
    if (this.hasProducts) {
        return false;
    }
    
    const subcategories = await this.getAllSubcategories();
    return !subcategories.some(subcat => subcat.hasProducts);
};

categorySchema.set('toJSON', { virtuals: true });
categorySchema.set('toObject', { virtuals: true });

const Category = mongoose.model('Category', categorySchema);

module.exports = Category;