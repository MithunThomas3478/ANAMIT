const Product = require('../../models/productSchema');
const Category = require('../../models/categorySchema');
const Cart = require('../../models/cartSchema');
const Wishlist = require('../../models/wishlistSchema');
const mongoose = require('mongoose');


const getProductDetails = async (req, res) => {
    try {
        const productId = req.params.id;
        const userId = req.user?._id;

        // Fetch product, cart, and wishlist in parallel for better performance
        const [product, cart, wishlist] = await Promise.all([
            Product.findById(productId).populate('category').lean(),
            userId ? Cart.findOne({ user: userId, active: true }) : null,
            userId ? Wishlist.findOne({ user: userId }) : null
        ]);

        if (!product) {
            return res.status(404).render('error', { message: 'Product not found' });
        }

        // Track items in cart
        const cartVariants = cart?.items
            .filter(item => item.product.toString() === productId)
            .map(item => ({
                colorName: item.selectedColor.colorName,
                size: item.selectedSize,
                quantity: item.quantity
            })) || [];

        // Update stock values
        product.variants.forEach((variant, i) => {
            variant.colorVariant.forEach(size => {
                const inCart = cartVariants.find(item => 
                    item.colorName === variant.colorName &&
                    item.size === size.size
                );
                size.stock -= (inCart?.quantity || 0);
            });
        });

        // Check if product is in wishlist
        product.isInWishlist = wishlist?.hasProduct(productId) || false;

        // Get similar products and check their wishlist status
        const similarProducts = await Product.find({
            category: product.category._id,
            _id: { $ne: product._id },
            isListed: true
        })
        .select('productName variants productOffer')
        .limit(4)
        .lean();

        // Add wishlist status to similar products
        similarProducts.forEach(similarProduct => {
            similarProduct.isInWishlist = wishlist?.hasProduct(similarProduct._id) || false;
        });

        // Get wishlist count for header
        const wishlistCount = wishlist?.items.length || 0;

        res.render('buyingInterface', {
            title: product.productName,
            product,
            similarProducts,
            cartVariants,
            pageTitle: product.productName,
            metaDescription: product.description,
            wishlistCount // Add this for header wishlist count
        });

    } catch (error) {
        console.error('Error in getProductDetails:', error);
        res.status(500).render('error', { 
            message: 'Failed to load product details',
            error: process.env.NODE_ENV === 'development' ? error : {}
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

const getMensFashion = async (req, res) => {
    try {
        // Pagination setup
        const page = parseInt(req.query.page) || 1;
        const limit = 12;
        const skip = (page - 1) * limit;

        // Get the men's category
        const menCategory = await Category.findOne({
            isListed: true,
            name: 'MEN'
        });

        if (!menCategory) {
            return res.status(404).render('error', {
                message: 'Men\'s category not found',
                error: { status: 404 }
            });
        }

        // Get user's wishlist if user is logged in
      
        let userWishlist = [];
        if (req.user) {
            const wishlistDoc = await Wishlist.findOne({ user: req.user._id });
            console.log(wishlistDoc);
            if (wishlistDoc) {
                userWishlist = wishlistDoc.items.map(item => item.product.toString());

            }
        }


        // Build pipeline stages for aggregation
        const pipeline = [
            // Match base criteria
            {
                $match: {
                    isListed: true,
                    category: menCategory._id
                }
            },
            // Unwind variants array
            { $unwind: '$variants' },
            // Unwind colorVariant array
            { $unwind: '$variants.colorVariant' }
        ];

        // [Previous filtering logic remains the same]
        if (req.query.maxPrice) {
            const maxPrice = parseFloat(req.query.maxPrice);
            if (!isNaN(maxPrice) && maxPrice > 0) {
                pipeline.push({
                    $match: {
                        'variants.colorVariant.price': { $lte: maxPrice }
                    }
                });
            }
        }

        // Size filter
        if (req.query.sizes) {
            const validSizes = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];
            const sizes = Array.isArray(req.query.sizes) 
                ? req.query.sizes 
                : req.query.sizes.split(',');
            
            const filteredSizes = sizes.filter(size => 
                validSizes.includes(size.toUpperCase())
            );
            
            if (filteredSizes.length > 0) {
                pipeline.push({
                    $match: {
                        'variants.colorVariant.size': {
                            $in: filteredSizes.map(size => size.toUpperCase())
                        }
                    }
                });
            }
        }

        // Color filter
        if (req.query.colors) {
            const colors = Array.isArray(req.query.colors)
                ? req.query.colors
                : req.query.colors.split(',');
            
            const validColors = colors.filter(color => color.trim());
            if (validColors.length > 0) {
                pipeline.push({
                    $match: {
                        'variants.colorName': {
                            $in: validColors.map(color => 
                                new RegExp(color.trim(), 'i')
                            )
                        }
                    }
                });
            }
        }

        // Group back with all previous fields
        pipeline.push({
            $group: {
                _id: '$_id',
                productName: { $first: '$productName' },
                productOffer: { $first: '$productOffer' },
                createdAt: { $first: '$createdAt' },
                viewCount: { $first: '$viewCount' },
                variants: {
                    $first: {
                        $map: {
                            input: ['$variants'],
                            as: 'variant',
                            in: {
                                colorName: '$$variant.colorName',
                                colorValue: '$$variant.colorValue',
                                productImage: '$$variant.productImage',
                                colorVariant: {
                                    $map: {
                                        input: ['$variants.colorVariant'],
                                        as: 'cv',
                                        in: {
                                            size: '$$cv.size',
                                            price: '$$cv.price',
                                            stock: '$$cv.stock'
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        });

        // Add sorting
        let sortStage = {};
        switch (req.query.sort) {
            case 'popularity':
                sortStage = { viewCount: -1, createdAt: -1 };
                break;
            case 'price_asc':
                sortStage = { 'variants.colorVariant.price': 1 };
                break;
            case 'price_desc':
                sortStage = { 'variants.colorVariant.price': -1 };
                break;
            case 'newest':
                sortStage = { createdAt: -1 };
                break;
            case 'name_asc':
                sortStage = { productName: 1 };
                break;
            case 'name_desc':
                sortStage = { productName: -1 };
                break;
            default:
                sortStage = { productOffer: -1, createdAt: -1 };
        }

        pipeline.push({ $sort: sortStage });
        pipeline.push({ $skip: skip });
        pipeline.push({ $limit: limit });

        // Execute the aggregation
        let products = await Product.aggregate(pipeline);

        // Add isInWishlist field to products
        products = products.map(product => ({
            ...product,
            isInWishlist: userWishlist.includes(product._id.toString())
        }));

        // Get total count for pagination
        const totalProducts = await Product.aggregate([
            ...pipeline.slice(0, -2),
            { $count: 'total' }
        ]);

        const total = totalProducts[0]?.total || 0;
        const totalPages = Math.ceil(total / limit);

        // Get unique colors
        const allColors = [...new Set(products.flatMap(product => 
            product.variants.map(variant => JSON.stringify({
                colorName: variant.colorName,
                colorValue: variant.colorValue
            }))
        ))].map(color => JSON.parse(color));

        // Get price range
        const priceStats = await Product.aggregate([
            { $match: { category: menCategory._id, isListed: true } },
            { $unwind: '$variants' },
            { $unwind: '$variants.colorVariant' },
            {
                $group: {
                    _id: null,
                    minPrice: { $min: '$variants.colorVariant.price' },
                    maxPrice: { $max: '$variants.colorVariant.price' }
                }
            }
        ]);

        // Get wishlist count if user is logged in
        let wishlistCount = 0;
        if (req.user) {
            const wishlistDoc = await Wishlist.findOne({ userId: req.user._id });
            wishlistCount = wishlistDoc ? wishlistDoc.products.length : 0;
        }

        // Render response
        res.render('categoryMenwear', {
            title: "MEN",
            category: menCategory,
            products,
            colors: allColors,
            currentFilters: req.query,
            priceRange: priceStats[0] || { minPrice: 0, maxPrice: 10000 },
            pagination: {
                currentPage: page,
                totalPages,
                hasNextPage: page < totalPages,
                hasPreviousPage: page > 1,
                nextPage: page + 1,
                previousPage: page - 1,
                totalProducts: total
            },
            wishlistCount, // Add wishlist count to the response
            isAuthenticated: !!req.user // Add authentication status
        });

    } catch (error) {
        console.error('Error in getMensFashion:', error);
        res.status(500).render('error', {
            message: 'Something went wrong while fetching products',
            error: process.env.NODE_ENV === 'development' ? error : {}
        });
    }
};

const getWomensFashion = async (req, res) => {
    try {
        // Pagination setup
        const page = parseInt(req.query.page) || 1;
        const limit = 12;
        const skip = (page - 1) * limit;

        // Get the women's category
        const womenCategory = await Category.findOne({
            isListed: true,
            name: 'WOMEN'
        });

        if (!womenCategory) {
            return res.status(404).render('error', {
                message: 'Women\'s category not found',
                error: { status: 404 }
            });
        }

        // Get user's wishlist if user is logged in
     
        let userWishlist = [];
        if (req.user) {
            const wishlistDoc = await Wishlist.findOne({ user: req.user._id });
            if (wishlistDoc) {
                userWishlist = wishlistDoc.items.map(item => item.product.toString());
            }
        }

        // Build pipeline stages for aggregation
        const pipeline = [
            // Match base criteria
            {
                $match: {
                    isListed: true,
                    category: womenCategory._id
                }
            },
            // Unwind variants array
            { $unwind: '$variants' },
            // Unwind colorVariant array
            { $unwind: '$variants.colorVariant' }
        ];

        // Price filter
        if (req.query.maxPrice) {
            const maxPrice = parseFloat(req.query.maxPrice);
            if (!isNaN(maxPrice) && maxPrice > 0) {
                pipeline.push({
                    $match: {
                        'variants.colorVariant.price': { $lte: maxPrice }
                    }
                });
            }
        }

        // Size filter
        if (req.query.sizes) {
            const validSizes = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];
            const sizes = Array.isArray(req.query.sizes) 
                ? req.query.sizes 
                : req.query.sizes.split(',');
            
            const filteredSizes = sizes.filter(size => 
                validSizes.includes(size.toUpperCase())
            );
            
            if (filteredSizes.length > 0) {
                pipeline.push({
                    $match: {
                        'variants.colorVariant.size': {
                            $in: filteredSizes.map(size => size.toUpperCase())
                        }
                    }
                });
            }
        }

        // Color filter
        if (req.query.colors) {
            const colors = Array.isArray(req.query.colors)
                ? req.query.colors
                : req.query.colors.split(',');
            
            const validColors = colors.filter(color => color.trim());
            if (validColors.length > 0) {
                pipeline.push({
                    $match: {
                        'variants.colorName': {
                            $in: validColors.map(color => 
                                new RegExp(color.trim(), 'i')
                            )
                        }
                    }
                });
            }
        }

        // Group back with all previous fields
        pipeline.push({
            $group: {
                _id: '$_id',
                productName: { $first: '$productName' },
                productOffer: { $first: '$productOffer' },
                createdAt: { $first: '$createdAt' },
                viewCount: { $first: '$viewCount' },
                variants: {
                    $first: {
                        $map: {
                            input: ['$variants'],
                            as: 'variant',
                            in: {
                                colorName: '$$variant.colorName',
                                colorValue: '$$variant.colorValue',
                                productImage: '$$variant.productImage',
                                colorVariant: {
                                    $map: {
                                        input: ['$variants.colorVariant'],
                                        as: 'cv',
                                        in: {
                                            size: '$$cv.size',
                                            price: '$$cv.price',
                                            stock: '$$cv.stock'
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        });

        // Add sorting
        let sortStage = {};
        switch (req.query.sort) {
            case 'popularity':
                sortStage = { viewCount: -1, createdAt: -1 };
                break;
            case 'price_asc':
                sortStage = { 'variants.colorVariant.price': 1 };
                break;
            case 'price_desc':
                sortStage = { 'variants.colorVariant.price': -1 };
                break;
            case 'newest':
                sortStage = { createdAt: -1 };
                break;
            case 'name_asc':
                sortStage = { productName: 1 };
                break;
            case 'name_desc':
                sortStage = { productName: -1 };
                break;
            default:
                sortStage = { productOffer: -1, createdAt: -1 };
        }

        pipeline.push({ $sort: sortStage });
        pipeline.push({ $skip: skip });
        pipeline.push({ $limit: limit });

        // Execute the aggregation
        let products = await Product.aggregate(pipeline);

        // Add isInWishlist field to products
        products = products.map(product => ({
            ...product,
            isInWishlist: userWishlist.includes(product._id.toString())
        }));

        // Get total count for pagination
        const totalProducts = await Product.aggregate([
            ...pipeline.slice(0, -2),
            { $count: 'total' }
        ]);

        const total = totalProducts[0]?.total || 0;
        const totalPages = Math.ceil(total / limit);

        // Get unique colors
        const allColors = [...new Set(products.flatMap(product => 
            product.variants.map(variant => JSON.stringify({
                colorName: variant.colorName,
                colorValue: variant.colorValue
            }))
        ))].map(color => JSON.parse(color));

        // Get price range
        const priceStats = await Product.aggregate([
            { $match: { category: womenCategory._id, isListed: true } },
            { $unwind: '$variants' },
            { $unwind: '$variants.colorVariant' },
            {
                $group: {
                    _id: null,
                    minPrice: { $min: '$variants.colorVariant.price' },
                    maxPrice: { $max: '$variants.colorVariant.price' }
                }
            }
        ]);

        // Get wishlist count if user is logged in
        let wishlistCount = 0;
        if (req.user) {
            const wishlistDoc = await Wishlist.findOne({ userId: req.user._id });
            wishlistCount = wishlistDoc ? wishlistDoc.products.length : 0;
        }

        // Render response
        res.render('categoryWomenwear', {
            title: "WOMEN",
            category: womenCategory,
            products,
            colors: allColors,
            currentFilters: req.query,
            priceRange: priceStats[0] || { minPrice: 0, maxPrice: 10000 },
            pagination: {
                currentPage: page,
                totalPages,
                hasNextPage: page < totalPages,
                hasPreviousPage: page > 1,
                nextPage: page + 1,
                previousPage: page - 1,
                totalProducts: total
            },
            wishlistCount, // Add wishlist count to the response
            isAuthenticated: !!req.user // Add authentication status
        });

    } catch (error) {
        console.error('Error in getWomensFashion:', error);
        res.status(500).render('error', {
            message: 'Something went wrong while fetching products',
            error: process.env.NODE_ENV === 'development' ? error : {}
        });
    }
};

const toggleWishlist = async (req, res) => {
    try {
        if (!req.user || !req.user._id) {
            return res.status(401).json({
                success: false,
                message: 'Please login to continue'
            });
        }

        const { productId } = req.body;

        // Validate productId
        if (!productId || !mongoose.Types.ObjectId.isValid(productId)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid product ID'
            });
        }

        // Find or create wishlist
        let wishlist = await Wishlist.findOne({ user: req.user._id });
        if (!wishlist) {
            wishlist = new Wishlist({
                user: req.user._id,
                items: []
            });
        }

        // Get product details
        const product = await Product.findOne({
            _id: productId,
            isListed: true
        });

        if (!product) {
            return res.status(404).json({
                success: false,
                message: 'Product not found'
            });
        }

        let isInWishlist = false;

        if (wishlist.hasProduct(productId)) {
            // Remove from wishlist
            wishlist.removeProduct(productId);
        } else {
            // Add to wishlist using the schema method
            isInWishlist = await wishlist.addProduct(product);
        }

        await wishlist.save();

        res.json({
            success: true,
            isInWishlist,
            wishlistCount: wishlist.items.length,
            message: isInWishlist ? 'Added to wishlist' : 'Removed from wishlist'
        });

    } catch (error) {
        console.error('Error in toggleWishlist:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update wishlist'
        });
    }
};

const getWishlist = async (req, res) => {
    try {
        if (!req.user) {
            return res.redirect('/login');
        }

        // Get both wishlist and cart data
        const [wishlist, cart] = await Promise.all([
            Wishlist.findOne({ user: req.user._id })
                .populate({
                    path: 'items.product',
                    select: 'productName variants productOffer isListed brand description'
                }),
            Cart.findOne({ user: req.user._id, active: true })
        ]);

        if (!wishlist) {
            return res.render('wishlist', {
                wishlist: null,
                cartItems: [],
                title: 'My Wishlist'
            });
        }

        // Filter out unlisted products
        wishlist.items = wishlist.items.filter(item => item.product && item.product.isListed);

        // Process cart items for frontend use
        const cartItems = cart ? cart.items.map(item => ({
            product: item.product.toString(),
            selectedColor: item.selectedColor,
            selectedSize: item.selectedSize
        })) : [];

        // Process each wishlist item to include price information
        const processedWishlistItems = wishlist.items.map(item => {
            // Get default variant or selected variant
            const currentVariant = item.product.variants[0];
            const defaultPrice = currentVariant?.colorVariant[0]?.price || 0;
            
            // Calculate prices
            const basePrice = defaultPrice;
            const discountedPrice = item.product.productOffer ? 
                basePrice * (1 - item.product.productOffer/100) : basePrice;

            return {
                ...item.toObject(),
                currentPrice: discountedPrice,
                originalPrice: basePrice,
                inCart: cartItems.some(cartItem => 
                    cartItem.product === item.product._id.toString() &&
                    cartItem.selectedColor.colorName === (item.selectedVariant?.colorName || currentVariant?.colorName) &&
                    cartItem.selectedSize === (item.selectedVariant?.size || currentVariant?.colorVariant[0]?.size)
                )
            };
        });

        res.render('wishlist', {
            wishlist: {
                ...wishlist.toObject(),
                items: processedWishlistItems
            },
            cartItems,
            title: 'My Wishlist'
        });

    } catch (error) {
        console.error('Error in getWishlist:', error);
        res.status(500).render('error', {
            message: 'Failed to load wishlist',
            error: process.env.NODE_ENV === 'development' ? error : {}
        });
    }
};


const removeFromWishlist = async (req, res) => {
    try {
        const { productId } = req.body;
        const userId = req.user._id;

        const wishlist = await Wishlist.findOne({ user: userId });
        if (!wishlist) {
            return res.status(404).json({
                success: false,
                message: 'Wishlist not found'
            });
        }

        // Remove the product from the wishlist items array
        wishlist.items = wishlist.items.filter(item => 
            item.product.toString() !== productId.toString()
        );

        // Save the updated wishlist
        await wishlist.save();

        // Return the updated wishlist count
        res.json({
            success: true,
            message: 'Product removed from wishlist',
            wishlistCount: wishlist.items.length
        });

    } catch (error) {
        console.error('Error removing from wishlist:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to remove product from wishlist'
        });
    }
};
module.exports = {
    getProductDetails,
    addToCart,
    getMensFashion,
    getWomensFashion,
    toggleWishlist,
    getWishlist,
    removeFromWishlist
   
    
}