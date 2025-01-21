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

const getCart = async (req, res) => {
    try {
        // Find cart for current user with populated product details
        const cart = await Cart.findOne({ userId: req.user._id })
            .populate({
                path: 'items.productId',
                model: 'Product',
                select: 'productName variants isListed productOffer' // Select only needed fields
            });

        // If no cart exists, return empty cart
        if (!cart) {
            return res.status(200).json({
                success: true,
                cart: {
                    items: [],
                    totalPrice: 0
                }
            });
        }

        // Filter out items where product is not listed or has been deleted
        cart.items = cart.items.filter(item => {
            return item.productId && item.productId.isListed;
        });

        // Validate each item's availability and update quantities if needed
        let needsUpdate = false;
        cart.items = cart.items.map(item => {
            const product = item.productId;
            const variant = product.variants.find(v => v.colorName === item.colorName);
            
            if (!variant) {
                needsUpdate = true;
                return null;
            }

            const sizeVariant = variant.colorVariant.find(sv => sv.size === item.size);
            if (!sizeVariant || sizeVariant.status !== 'available') {
                needsUpdate = true;
                return null;
            }

            // Update quantity if current quantity exceeds available stock
            if (item.quantity > sizeVariant.stock) {
                needsUpdate = true;
                item.quantity = sizeVariant.stock;
                item.total = sizeVariant.price * sizeVariant.stock;
            }

            // Update price if it has changed
            if (item.price !== sizeVariant.price) {
                needsUpdate = true;
                item.price = sizeVariant.price;
                item.total = sizeVariant.price * item.quantity;
            }

            return item;
        }).filter(Boolean); // Remove null items

        // If any updates were needed, save the cart
        if (needsUpdate) {
            cart.totalPrice = cart.items.reduce((sum, item) => sum + item.total, 0);
            await cart.save();
        }

        // Transform cart data for response
        const cartResponse = {
            items: cart.items.map(item => ({
                productId: item.productId._id,
                productName: item.productId.productName,
                colorName: item.colorName,
                size: item.size,
                quantity: item.quantity,
                price: item.price,
                total: item.total,
                product: item.productId // Include full product details for the frontend
            })),
            totalPrice: cart.totalPrice,
            _id: cart._id,
            updatedAt: cart.updatedAt
        };

        res.render('shoppingCart',{
            cart: cartResponse
        });

    } catch (error) {
        console.error('Error in getCart:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch cart details'
        });
    }
};




const addToCart = async (req, res) => {
    try {
        const userId = req.user._id;
        const { productId, colorName, size, quantity, price } = req.body;

        // Validate input
        if (!productId || !colorName || !size || !quantity || !price) {
            return res.status(400).json({
                success: false,
                message: 'Missing required fields'
            });
        }

        // Find or create cart
        let cart = await Cart.findOne({ userId });
        if (!cart) {
            cart = new Cart({ userId, items: [] });
        }

        // Check if product exists and is listed
        const product = await Product.findById(productId);
        if (!product || !product.isListed) {
            return res.status(404).json({
                success: false,
                message: 'Product not found or unavailable'
            });
        }

        // Validate variant and stock
        const variant = product.variants.find(v => v.colorName === colorName);
        if (!variant) {
            return res.status(404).json({
                success: false,
                message: 'Product variant not found'
            });
        }

        const sizeVariant = variant.colorVariant.find(cv => cv.size === size);
        if (!sizeVariant || sizeVariant.stock < quantity || sizeVariant.status !== 'available') {
            return res.status(400).json({
                success: false,
                message: 'Selected size not available in requested quantity'
            });
        }

        // Add item to cart
        cart.addItem(productId, colorName, size, quantity, price);
        await cart.save();

        // Get updated cart count
        const cartCount = cart.items.reduce((sum, item) => sum + item.quantity, 0);

        return res.status(200).json({
            success: true,
            message: 'Item added to cart successfully',
            cartCount
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
    getCart,
    addToCart
    
   

}