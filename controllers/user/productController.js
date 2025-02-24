const Product = require('../../models/productSchema');
const Offer = require('../../models/offerSchema');
const Category = require('../../models/categorySchema');
const Cart = require('../../models/cartSchema');
const Wishlist = require('../../models/wishlistSchema');
const mongoose = require('mongoose');
const { ObjectId } = mongoose.Types;


const getProductDetails = async (req, res) => {
    try {
        const productId = req.params.id;
        const userId = req.user?._id;
        const currentDate = new Date();

        // Fetch product, cart, wishlist, and offers in parallel
        const [product, cart, wishlist, productOffer, categoryOffer] = await Promise.all([
            Product.findById(productId).populate('category').lean(),
            userId ? Cart.findOne({ user: userId, active: true }) : null,
            userId ? Wishlist.findOne({ user: userId }) : null,
            Offer.findOne({
                offerType: 'product',
                product: productId,
                isActive: true,
                startDate: { $lte: currentDate },
                endDate: { $gte: currentDate }
            }).lean(),
            Offer.findOne({
                offerType: 'category',
                isActive: true,
                startDate: { $lte: currentDate },
                endDate: { $gte: currentDate }
            }).lean()
        ]);

        if (!product) {
            return res.status(404).render('error', { message: 'Product not found' });
        }

        // Calculate best offer
        let bestOffer = null;
        let offerType = null;
        
        if (productOffer && categoryOffer) {
            bestOffer = productOffer.discountPercentage > categoryOffer.discountPercentage ? 
                productOffer : categoryOffer;
            offerType = productOffer.discountPercentage > categoryOffer.discountPercentage ? 
                'product' : 'category';
        } else {
            bestOffer = productOffer || categoryOffer;
            offerType = productOffer ? 'product' : 'category';
        }

        // Add offer information to product
        product.hasOffer = !!bestOffer;
        product.offerPercentage = bestOffer?.discountPercentage || 0;
        product.offerType = offerType;
        product.offerName = bestOffer?.name || '';

        // Track items in cart
        const cartVariants = cart?.items
            .filter(item => item.product.toString() === productId)
            .map(item => ({
                colorName: item.selectedColor.colorName,
                size: item.selectedSize,
                quantity: item.quantity
            })) || [];

        // Update stock values and calculate prices with offers
        product.variants.forEach(variant => {
            variant.colorVariant.forEach(size => {
                const inCart = cartVariants.find(item =>
                    item.colorName === variant.colorName &&
                    item.size === size.size
                );
                size.stock -= (inCart?.quantity || 0);

                // Calculate discounted price
                size.originalPrice = size.price;
                if (product.hasOffer) {
                    size.discountedPrice = size.price * (1 - product.offerPercentage/100);
                }
            });
        });

        // Check if product is in wishlist
        product.isInWishlist = wishlist?.hasProduct(productId) || false;

        // Get similar products with offers
        const similarProducts = await Product.find({
            category: product.category._id,
            _id: { $ne: product._id },
            isListed: true
        })
        .select('productName variants productOffer')
        .limit(4)
        .lean();

        // Process similar products
        const processedSimilarProducts = await Promise.all(similarProducts.map(async (similarProduct) => {
            const similarProductOffer = await Offer.findOne({
                offerType: 'product',
                product: similarProduct._id,
                isActive: true,
                startDate: { $lte: currentDate },
                endDate: { $gte: currentDate }
            });

            const bestSimilarOffer = similarProductOffer?.discountPercentage > (categoryOffer?.discountPercentage || 0) ?
                similarProductOffer : categoryOffer;

            return {
                ...similarProduct,
                isInWishlist: wishlist?.hasProduct(similarProduct._id) || false,
                hasOffer: !!bestSimilarOffer,
                offerPercentage: bestSimilarOffer?.discountPercentage || 0,
                offerType: similarProductOffer?.discountPercentage > (categoryOffer?.discountPercentage || 0) ?
                    'product' : 'category',
                originalPrice: similarProduct.variants[0].colorVariant[0].price,
                discountedPrice: bestSimilarOffer ? 
                    similarProduct.variants[0].colorVariant[0].price * 
                    (1 - bestSimilarOffer.discountPercentage/100) :
                    similarProduct.variants[0].colorVariant[0].price
            };
        }));

        const wishlistCount = wishlist?.items.length || 0;

        res.render('buyingInterface', {
            title: product.productName,
            product,
            similarProducts: processedSimilarProducts,
            cartVariants,
            pageTitle: product.productName,
            metaDescription: product.description,
            wishlistCount
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
        const { productId, colorName, size, quantity } = req.body;

        // Input validation
        const requiredFields = {
            productId: 'Product ID',
            colorName: 'Color',
            size: 'Size',
            quantity: 'Quantity'
        };

        for (const [field, label] of Object.entries(requiredFields)) {
            if (!req.body[field]) {
                return res.status(400).json({
                    success: false,
                    message: `${label} is required`
                });
            }
        }

        const parsedQuantity = parseInt(quantity);
        if (!Number.isInteger(parsedQuantity) || parsedQuantity < 1) {
            return res.status(400).json({
                success: false,
                message: 'Quantity must be a positive integer'
            });
        }

        // Fetch product and validate
        const product = await Product.findById(productId)
            .select('isListed variants productName category productOffer')
            .populate('category', 'name')
            .lean();

        if (!product || !product.isListed) {
            return res.status(404).json({
                success: false,
                message: 'Product not found or unavailable'
            });
        }

        // Validate color and size
        const variant = product.variants.find(v => 
            v.colorName.toLowerCase() === colorName.toLowerCase()
        );

        if (!variant) {
            return res.status(404).json({
                success: false,
                message: `Color ${colorName} not found`
            });
        }

        const sizeVariant = variant.colorVariant.find(cv => 
            cv.size.toLowerCase() === size.toLowerCase()
        );

        if (!sizeVariant || sizeVariant.status !== 'available' || sizeVariant.stock < parsedQuantity) {
            return res.status(400).json({
                success: false,
                message: `Size ${size} is unavailable or insufficient stock`
            });
        }

        // Get current date for offer validation
        const currentDate = new Date();

        // Fetch cart, wishlist, and offers concurrently
        const [cart, wishlist, productOffer, categoryOffer] = await Promise.all([
            Cart.findOne({ user: userId, active: true }),
            Wishlist.findOne({ user: userId }),
            Offer.findOne({
                offerType: 'product',
                product: productId,
                isActive: true,
                startDate: { $lte: currentDate },
                endDate: { $gte: currentDate }
            }).lean(),
            Offer.findOne({
                offerType: 'category',
                category: product.category,
                isActive: true,
                startDate: { $lte: currentDate },
                endDate: { $gte: currentDate }
            }).lean()
        ]);

        // Calculate best offer - take only the highest
        const productOfferPercentage = productOffer?.discountPercentage || product.productOffer || 0;
        const categoryOfferPercentage = categoryOffer?.discountPercentage || 0;
        
        // Choose the higher offer
        const bestOffer = Math.max(productOfferPercentage, categoryOfferPercentage);
        
        // Determine which type of offer was selected
        const selectedOfferType = bestOffer === productOfferPercentage ? 'product' : 'category';

        // Initialize or get existing cart
        let userCart = cart || new Cart({
            user: userId,
            items: [],
            active: true
        });

        // Check if item already exists in cart
        const existingItemIndex = userCart.items.findIndex(item => 
            item.product.toString() === productId &&
            item.selectedColor.colorName.toLowerCase() === colorName.toLowerCase() &&
            item.selectedSize.toLowerCase() === size.toLowerCase()
        );

        const basePrice = sizeVariant.price;

        if (existingItemIndex > -1) {
            // Update existing item
            const newQuantity = userCart.items[existingItemIndex].quantity + parsedQuantity;
            
            if (sizeVariant.stock < newQuantity) {
                return res.status(400).json({
                    success: false,
                    message: `Cannot add ${parsedQuantity} more items. Stock limit reached.`
                });
            }

            // Update quantity and apply the best offer
            userCart.items[existingItemIndex].quantity = newQuantity;
            userCart.items[existingItemIndex].appliedProductOffer = selectedOfferType === 'product' ? bestOffer : 0;
            userCart.items[existingItemIndex].appliedCategoryOffer = selectedOfferType === 'category' ? bestOffer : 0;
        } else {
            // Add new item with the best offer
            userCart.items.push({
                product: productId,
                selectedColor: {
                    colorName: variant.colorName,
                    colorValue: variant.colorValue
                },
                selectedSize: size,
                quantity: parsedQuantity,
                price: basePrice,
                appliedProductOffer: selectedOfferType === 'product' ? bestOffer : 0,
                appliedCategoryOffer: selectedOfferType === 'category' ? bestOffer : 0
            });
        }

        // Remove from wishlist if present
        let wishlistCount = null;
        if (wishlist && wishlist.hasProduct(productId)) {
            wishlist.removeProduct(productId);
            await wishlist.save();
            wishlistCount = wishlist.items.length; // Update wishlist count
        }

        // Save cart and recalculate totals
        await userCart.save();

        // Calculate response data
        const cartCount = userCart.items.reduce((sum, item) => sum + item.quantity, 0);

        return res.status(200).json({
            success: true,
            message: 'Item added to cart successfully',
            cartCount,
            wishlistCount, // Return updated wishlist count
            cart: {
                totalAmount: userCart.totalAmount,
                totalDiscount: userCart.totalDiscount,
                finalAmount: userCart.totalAmount - userCart.totalDiscount
            }
        });

    } catch (error) {
        console.error('Add to cart error:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to add item to cart'
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

        // Get subcategories
        const subcategories = await Category.find({
            parent: menCategory._id,
            isListed: true
        }).select('name productCount');

        // Get active category offer
        const currentDate = new Date();
        const categoryOffer = await Offer.findOne({
            offerType: 'category',
            category: menCategory._id,
            isActive: true,
            startDate: { $lte: currentDate },
            endDate: { $gte: currentDate }
        });

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
                    category: menCategory._id
                }
            }
        ];

        // Add subcategory filter if present in query
        if (req.query.subcategories) {
            const subcatIds = req.query.subcategories.split(',').map(id => 
                mongoose.Types.ObjectId(id.trim())
            ).filter(id => id); // Filter out any invalid IDs
            
            if (subcatIds.length > 0) {
                pipeline.push({
                    $match: {
                        subcategory: { $in: subcatIds }
                    }
                });
            }
        }

        // Add product offer lookup
        pipeline.push({
            $lookup: {
                from: 'offers',
                let: { productId: '$_id' },
                pipeline: [
                    {
                        $match: {
                            $expr: {
                                $and: [
                                    { $eq: ['$offerType', 'product'] },
                                    { $eq: ['$product', '$$productId'] },
                                    { $eq: ['$isActive', true] },
                                    { $lte: ['$startDate', currentDate] },
                                    { $gte: ['$endDate', currentDate] }
                                ]
                            }
                        }
                    }
                ],
                as: 'productOffer'
            }
        });

        // Unwind variants array
        pipeline.push(
            { $unwind: '$variants' },
            { $unwind: '$variants.colorVariant' }
        );

        // Add price calculation fields
        pipeline.push({
            $addFields: {
                basePrice: '$variants.colorVariant.price',
                productOfferDiscount: {
                    $cond: {
                        if: { $gt: [{ $size: '$productOffer' }, 0] },
                        then: {
                            $multiply: [
                                '$variants.colorVariant.price',
                                { $divide: [{ $arrayElemAt: ['$productOffer.discountPercentage', 0] }, 100] }
                            ]
                        },
                        else: 0
                    }
                },
                categoryOfferDiscount: {
                    $cond: {
                        if: { $and: [
                            { $ne: [categoryOffer, null] },
                            { $ne: [categoryOffer?.discountPercentage, null] }
                        ]},
                        then: {
                            $multiply: [
                                '$variants.colorVariant.price',
                                { $divide: [(categoryOffer?.discountPercentage || 0), 100] }
                            ]
                        },
                        else: 0
                    }
                }
            }
        });

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

        // Calculate final price and offer details
        pipeline.push({
            $addFields: {
                maxDiscount: {
                    $max: ['$productOfferDiscount', '$categoryOfferDiscount']
                },
                finalPrice: {
                    $subtract: [
                        '$basePrice',
                        {
                            $max: ['$productOfferDiscount', '$categoryOfferDiscount']
                        }
                    ]
                },
                appliedOfferType: {
                    $cond: {
                        if: { $gt: ['$productOfferDiscount', '$categoryOfferDiscount'] },
                        then: 'product',
                        else: 'category'
                    }
                },
                hasOffer: {
                    $gt: [
                        { $max: ['$productOfferDiscount', '$categoryOfferDiscount'] },
                        0
                    ]
                }
            }
        });

        // Group back products
        pipeline.push({
            $group: {
                _id: '$_id',
                productName: { $first: '$productName' },
                productOffer: { $first: '$productOffer' },
                createdAt: { $first: '$createdAt' },
                viewCount: { $first: '$viewCount' },
                basePrice: { $first: '$basePrice' },
                finalPrice: { $first: '$finalPrice' },
                hasOffer: { $first: '$hasOffer' },
                appliedOfferType: { $first: '$appliedOfferType' },
                maxDiscount: { $first: '$maxDiscount' },
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
                sortStage = { finalPrice: 1 };
                break;
            case 'price_desc':
                sortStage = { finalPrice: -1 };
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

        // Process products and add wishlist info
        products = products.map(product => ({
            ...product,
            isInWishlist: userWishlist.includes(product._id.toString()),
            discountPercentage: product.hasOffer && product.basePrice > 0 ? 
                Math.round(((product.basePrice - product.finalPrice) / product.basePrice) * 100) : 0
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

        // Render response
        res.render('categoryMenwear', {
            title: "MEN",
            category: menCategory,
            products,
            colors: allColors,
            subcategories, // Add subcategories to the render data
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
            categoryOffer,
            wishlistCount: userWishlist.length,
            isAuthenticated: !!req.user
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

        // Get subcategories
        const subcategories = await Category.find({
            parent: womenCategory._id,
            isListed: true
        }).select('name productCount');

        // Get active category offer
        const currentDate = new Date();
        const categoryOffer = await Offer.findOne({
            offerType: 'category',
            category: womenCategory._id,
            isActive: true,
            startDate: { $lte: currentDate },
            endDate: { $gte: currentDate }
        });

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
            }
        ];

        // Add subcategory filter if present in query
        if (req.query.subcategories) {
            const subcatIds = req.query.subcategories.split(',').map(id => 
                mongoose.Types.ObjectId(id.trim())
            ).filter(id => id); // Filter out any invalid IDs
            
            if (subcatIds.length > 0) {
                pipeline.push({
                    $match: {
                        subcategory: { $in: subcatIds }
                    }
                });
            }
        }

        // Add product offer lookup
        pipeline.push({
            $lookup: {
                from: 'offers',
                let: { productId: '$_id' },
                pipeline: [
                    {
                        $match: {
                            $expr: {
                                $and: [
                                    { $eq: ['$offerType', 'product'] },
                                    { $eq: ['$product', '$$productId'] },
                                    { $eq: ['$isActive', true] },
                                    { $lte: ['$startDate', currentDate] },
                                    { $gte: ['$endDate', currentDate] }
                                ]
                            }
                        }
                    }
                ],
                as: 'productOffer'
            }
        });

        // Unwind variants array
        pipeline.push(
            { $unwind: '$variants' },
            { $unwind: '$variants.colorVariant' }
        );

        // Add price calculation fields
        pipeline.push({
            $addFields: {
                basePrice: '$variants.colorVariant.price',
                productOfferDiscount: {
                    $cond: {
                        if: { $gt: [{ $size: '$productOffer' }, 0] },
                        then: {
                            $multiply: [
                                '$variants.colorVariant.price',
                                { $divide: [{ $arrayElemAt: ['$productOffer.discountPercentage', 0] }, 100] }
                            ]
                        },
                        else: 0
                    }
                },
                categoryOfferDiscount: {
                    $cond: {
                        if: { $and: [
                            { $ne: [categoryOffer, null] },
                            { $ne: [categoryOffer?.discountPercentage, null] }
                        ]},
                        then: {
                            $multiply: [
                                '$variants.colorVariant.price',
                                { $divide: [(categoryOffer?.discountPercentage || 0), 100] }
                            ]
                        },
                        else: 0
                    }
                }
            }
        });

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

        // Calculate final price and offer details
        pipeline.push({
            $addFields: {
                maxDiscount: {
                    $max: ['$productOfferDiscount', '$categoryOfferDiscount']
                },
                finalPrice: {
                    $subtract: [
                        '$basePrice',
                        {
                            $max: ['$productOfferDiscount', '$categoryOfferDiscount']
                        }
                    ]
                },
                appliedOfferType: {
                    $cond: {
                        if: { $gt: ['$productOfferDiscount', '$categoryOfferDiscount'] },
                        then: 'product',
                        else: 'category'
                    }
                },
                hasOffer: {
                    $gt: [
                        { $max: ['$productOfferDiscount', '$categoryOfferDiscount'] },
                        0
                    ]
                }
            }
        });

        // Group back products
        pipeline.push({
            $group: {
                _id: '$_id',
                productName: { $first: '$productName' },
                productOffer: { $first: '$productOffer' },
                createdAt: { $first: '$createdAt' },
                viewCount: { $first: '$viewCount' },
                basePrice: { $first: '$basePrice' },
                finalPrice: { $first: '$finalPrice' },
                hasOffer: { $first: '$hasOffer' },
                appliedOfferType: { $first: '$appliedOfferType' },
                maxDiscount: { $first: '$maxDiscount' },
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
                sortStage = { finalPrice: 1 };
                break;
            case 'price_desc':
                sortStage = { finalPrice: -1 };
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

        // Process products and add wishlist info
        products = products.map(product => ({
            ...product,
            isInWishlist: userWishlist.includes(product._id.toString()),
            discountPercentage: product.hasOffer && product.basePrice > 0 ? 
                Math.round(((product.basePrice - product.finalPrice) / product.basePrice) * 100) : 0
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

        // Render response
        res.render('categoryWomenwear', {
            title: "WOMEN",
            category: womenCategory,
            products,
            colors: allColors,
            subcategories,
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
            categoryOffer,
            wishlistCount: userWishlist.length,
            isAuthenticated: !!req.user
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