const Product = require('../../models/productSchema');
const Category = require('../../models/categorySchema');
const Cart = require('../../models/cartSchema')

const getProductDetails = async (req, res) => {
    try {
        const productId = req.params.id;
        
        // Fetch the product with populated category
        const product = await Product.findById(productId)
            .populate('category')
            .lean(); // Using lean() for better performance
        
        if (!product) {
            return res.status(404).render('error', {
                message: 'Product not found'
            });
        }

        // Debug logs to verify product data
        console.log('Product details:', {
            id: product._id,
            name: product.productName,
            price: product.variants?.[0]?.colorVariant?.[0]?.price,
            variants: product.variants?.length
        });

        // Fetch similar products from the same category
        const similarProducts = await Product.find({
            category: product.category._id,
            _id: { $ne: product._id },
            isListed: true
        })
        .select('productName variants productOffer') // Make sure these fields are included
        .limit(4)
        .lean();

        // Render the product details page
        res.render('buyingInterface', {
            title: product.productName,
            product,
            similarProducts,
            pageTitle: product.productName, // Adding pageTitle for SEO
            metaDescription: product.description // Optional: for SEO
        });

    } catch (error) {
        console.error('Error in getProductDetails:', error);
        res.status(500).render('error', {
            message: 'Failed to load product details'
        });
    }
};





const addToCart = async (req, res) => {
    try {
        const userId = req.user._id;
        const { productId, colorName, size, quantity, price } = req.body;

        // Input validation with specific error messages
        const requiredFields = {
            productId: 'Product ID',
            colorName: 'Color',
            size: 'Size',
            quantity: 'Quantity',
            price: 'Price'
        };

        for (const [field, label] of Object.entries(requiredFields)) {
            if (!req.body[field]) {
                return res.status(400).json({
                    success: false,
                    message: `${label} is required`
                });
            }
        }

        // Validate quantity is positive integer
        if (!Number.isInteger(quantity) || quantity < 1) {
            return res.status(400).json({
                success: false,
                message: 'Quantity must be a positive integer'
            });
        }

        // Find existing cart with proper error handling
        let cart = await Cart.findOne({ user: userId, active: true });
        
        // If no cart exists, create new one
        if (!cart) {
            cart = new Cart({
                user: userId,
                items: [],
                active: true
            });
        }

        // Find product with specific fields needed
        const product = await Product.findById(productId)
            .select('isListed variants productName')
            .lean();

        if (!product) {
            return res.status(404).json({
                success: false,
                message: 'Product not found'
            });
        }

        if (!product.isListed) {
            return res.status(404).json({
                success: false,
                message: 'Product is currently unavailable'
            });
        }

        // Find color variant
        const variant = product.variants.find(v => 
            v.colorName.toLowerCase() === colorName.toLowerCase()
        );

        if (!variant) {
            return res.status(404).json({
                success: false,
                message: `Color ${colorName} not found for this product`
            });
        }

        // Find size variant with case-insensitive comparison
        const sizeVariant = variant.colorVariant.find(cv => 
            cv.size.toLowerCase() === size.toLowerCase()
        );

        if (!sizeVariant) {
            return res.status(404).json({
                success: false,
                message: `Size ${size} not available in ${colorName}`
            });
        }

        if (sizeVariant.status !== 'available') {
            return res.status(400).json({
                success: false,
                message: `Size ${size} is currently ${sizeVariant.status}`
            });
        }

        if (sizeVariant.stock < quantity) {
            return res.status(400).json({
                success: false,
                message: `Only ${sizeVariant.stock} items available in size ${size}`
            });
        }

        // Check if item already exists in cart
        const existingItemIndex = cart.items.findIndex(item => 
            item.product.toString() === productId &&
            item.selectedColor.colorName.toLowerCase() === colorName.toLowerCase() &&
            item.selectedSize.toLowerCase() === size.toLowerCase()
        );

        if (existingItemIndex > -1) {
            // Update existing item
            const newQuantity = cart.items[existingItemIndex].quantity + quantity;
            
            // Recheck stock for combined quantity
            if (sizeVariant.stock < newQuantity) {
                return res.status(400).json({
                    success: false,
                    message: `Cannot add ${quantity} more items. Stock limit reached.`
                });
            }

            cart.items[existingItemIndex].quantity = newQuantity;
        } else {
            // Add new item
            cart.items.push({
                product: productId,
                selectedColor: {
                    colorName: variant.colorName,
                    colorValue: variant.colorValue
                },
                selectedSize: size,
                quantity: quantity,
                price: price,
                // Get current offers if any
                appliedProductOffer: product.productOffer || 0,
                appliedCategoryOffer: product.categoryOffer || 0
            });
        }

        // Save cart with error handling
        try {
            await cart.save();
        } catch (saveError) {
            console.error('Cart save error:', saveError);
            return res.status(500).json({
                success: false,
                message: 'Failed to save cart',
                error: saveError.message
            });
        }

        // Calculate total items in cart
        const cartCount = cart.items.reduce((sum, item) => sum + item.quantity, 0);

        return res.status(200).json({
            success: true,
            message: 'Item added to cart successfully',
            cartCount,
            cart: {
                totalAmount: cart.totalAmount,
                totalDiscount: cart.totalDiscount,
                finalAmount: cart.totalAmount - cart.totalDiscount
            }
        });

    } catch (error) {
        console.error('Add to cart error:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to add item to cart',
            error: error.message
        });
    }
};

module.exports = {
    getProductDetails,
    addToCart,
   
    
}