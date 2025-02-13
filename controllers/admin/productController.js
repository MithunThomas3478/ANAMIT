const fs = require("fs");
const path = require("path");
const sharp = require("sharp");
const User = require("../../models/userSchema");
const Category = require("../../models/categorySchema");
const Product = require("../../models/productSchema");
const { v4: uuidv4 } = require("uuid");
const { log } = require("console");

const loadAddCategory = async (req, res) => {
    try {
        // Get all root categories with their subcategories
        const categories = await Category.find({ level: 0, isListed: true })
            .populate({
                path: 'subcategories',
                match: { isListed: true }, // Only populate listed subcategories
                select: '_id name'
            });

        // Format categories for frontend with full details
        const formattedCategories = categories.map(cat => ({
            _id: cat._id.toString(), // Ensure _id is a string
            name: cat.name,
            subcategories: cat.subcategories.map(sub => ({
                _id: sub._id.toString(), // Ensure subcategory _id is a string
                name: sub.name
            }))
        }));

        // Debug logging
        console.log('Formatted Categories:', JSON.stringify(formattedCategories, null, 2));

        res.render("productAdd", {
            categories: formattedCategories,
            maxDescriptionLength: 1000,
            maxShortDescLength: 200,
            validSizes: ['XS', 'S', 'M', 'L', 'XL', 'XXL']
        });
    } catch (err) {
        console.error("Error loading add product page:", err);
        res.status(500).render('error', {
            message: 'Error loading add product page',
            error: process.env.NODE_ENV === 'development' ? err : {}
        });
    }
};

const addProducts = async (req, res) => {
    try {
        const productData = req.body;
        console.log("Request data:", productData);
        
        // Log file information more thoroughly
        if (req.files) {
            console.log("Number of files received:", req.files.length);
            req.files.forEach((file, index) => {
                console.log(`File ${index + 1}:`, {
                    fieldname: file.fieldname,
                    mimetype: file.mimetype,
                    size: file.size,
                    buffer: file.buffer ? 'Buffer present' : 'No buffer'
                });
            });
        }

        // Parse variants data
        const variants = JSON.parse(productData.variants);
        console.log("Parsed variants:", variants);

        // Check for existing product
        const existingProduct = await Product.findOne({
            productName: { $regex: new RegExp(`^${productData.productName}$`, 'i') }
        });

        if (existingProduct) {
            return res.status(400).json({
                success: false,
                message: "Product already exists with this name"
            });
        }

        // Group files by variant
        const filesByVariant = {};
        if (req.files && req.files.length > 0) {
            req.files.forEach((file) => {
                const matches = file.fieldname.match(/variants\[(\d+)\]\[images\]\[(\d+)\]/);
                if (matches) {
                    const variantIndex = matches[1];
                    if (!filesByVariant[variantIndex]) {
                        filesByVariant[variantIndex] = [];
                    }
                    filesByVariant[variantIndex].push(file);
                }
            });
        }

        // Process variants and images
        const processedVariants = await Promise.all(variants.map(async (variant, variantIndex) => {
            const files = filesByVariant[variantIndex] || [];
            console.log(`Processing ${files.length} images for variant ${variantIndex}`);

            const variantImages = await Promise.all(files.map(async (file, imageIndex) => {
                try {
                    // Validate file buffer
                    if (!file.buffer || file.buffer.length === 0) {
                        throw new Error('Empty or invalid file buffer');
                    }

                    // Validate file type
                    if (!file.mimetype.startsWith('image/')) {
                        throw new Error('Invalid file type. Only images are allowed.');
                    }

                    const ext = file.originalname.split('.').pop().toLowerCase();
                    const filename = `${uuidv4()}.${ext}`;
                    const imagePath = path.join('public', 'uploads', 'product-images', filename);
                    
                    // Ensure directory exists
                    await fs.promises.mkdir(path.dirname(imagePath), { recursive: true });

                    // Add more detailed error handling for Sharp
                    try {
                        const sharpInstance = sharp(file.buffer);
                        // Validate image metadata before processing
                        const metadata = await sharpInstance.metadata();
                        console.log(`Image ${imageIndex} metadata:`, metadata);

                        await sharpInstance
                            .resize(800, 800, {
                                fit: 'cover',
                                position: 'center'
                            })
                            .toFormat('jpeg', { quality: 90 })
                            .toFile(imagePath);

                        return `/uploads/product-images/${filename}`;
                    } catch (sharpError) {
                        console.error(`Sharp processing error for image ${imageIndex}:`, sharpError);
                        throw new Error(`Image processing failed: ${sharpError.message}`);
                    }
                } catch (error) {
                    console.error(`Error processing image ${imageIndex} for variant ${variantIndex}:`, error);
                    throw new Error(`Failed to process image ${imageIndex}: ${error.message}`);
                }
            }));

            return {
                colorValue: variant.colorValue,
                colorName: variant.colorName,
                colorVariant: variant.sizes.map(size => ({
                    size: size.size,
                    stock: parseInt(size.stock, 10),
                    price: parseFloat(size.price),
                    status: size.status
                })),
                productImage: variantImages
            };
        }));

        // Create new product
        const newProduct = new Product({
            productName: productData.productName,
            description: productData.description,
            shortDescription: productData.shortDescription || '',
            category: productData.category,
            subcategory: productData.subcategory || null,
            variants: processedVariants,
            searchKeywords: [
                productData.productName,
                ...processedVariants.map(v => v.colorName)
            ],
            isListed: true
        });

        await newProduct.validate();
        await newProduct.save();

        return res.status(200).json({
            success: true,
            message: "Product added successfully",
            product: newProduct
        });

    } catch (error) {
        console.error("Error adding product:", error);
        
        if (error.name === 'ValidationError') {
            return res.status(400).json({
                success: false,
                message: "Validation error",
                errors: Object.values(error.errors).map(err => err.message)
            });
        }

        return res.status(500).json({
            success: false,
            message: error.message || "Error adding product"
        });
    }
};

    
    const loadProductPage = async (req, res) => {
        try {
            // Get all query parameters
            const page = parseInt(req.query.page) || 1;
            const limit = 4;
            const skip = (page - 1) * limit;
            
            // Get filter parameters
            const search = req.query.search || '';
            const category = req.query.category || '';
            const stock = req.query.stock || '';
            const sort = req.query.sort || '';
    
            // Build the filter query
            let filterQuery = {};
            if (search) {
                filterQuery.$or = [
                    { productName: { $regex: search, $options: 'i' } },
                    { 'variants.colorName': { $regex: search, $options: 'i' } }
                ];
            }
            if (category) {
                filterQuery.category = category;
            }
    
            // Get products with filters
            const [products, totalProducts] = await Promise.all([
                Product.find(filterQuery)
                    .populate('category')
                    .sort({ createdOn: -1 })
                    .skip(skip)
                    .limit(limit)
                    .lean(),
                Product.countDocuments(filterQuery)
            ]);
    
            // Calculate price ranges and total stock for each product
            const processedProducts = products.map(product => {
                let minPrice = Infinity;
                let maxPrice = -Infinity;
                let totalStock = 0;
    
                product.variants.forEach(variant => {
                    variant.colorVariant.forEach(size => {
                        const finalPrice = size.price * (1 - (product.productOffer / 100));
                        minPrice = Math.min(minPrice, finalPrice);
                        maxPrice = Math.max(maxPrice, finalPrice);
                        totalStock += size.stock;
                    });
                });
    
                return {
                    ...product,
                    priceRange: {
                        min: minPrice === Infinity ? 0 : minPrice,
                        max: maxPrice === -Infinity ? 0 : maxPrice
                    },
                    totalStock
                };
            });
    
            // Get statistics
            const [activeProducts, lowStockProducts, topRatedProducts, categories] = await Promise.all([
                Product.countDocuments({ isListed: true }),
                Product.countDocuments({
                    'variants.colorVariant': {
                        $elemMatch: { stock: { $gt: 0, $lte: 10 } }
                    }
                }),
                Product.countDocuments({
                    'ratings.average': { $gte: 4 }
                }),
                Category.find().select('name').lean()
            ]);
    
            // Calculate total pages
            const totalPages = Math.ceil(totalProducts / limit);
    
            // Build search parameters string for pagination
            const searchParamsObj = new URLSearchParams();
            if (search) searchParamsObj.append('search', search);
            if (category) searchParamsObj.append('category', category);
            if (stock) searchParamsObj.append('stock', stock);
            if (sort) searchParamsObj.append('sort', sort);
            const searchParams = searchParamsObj.toString() ? `&${searchParamsObj.toString()}` : '';
    
            // Render the page with all data
            res.render("productManagement", {
                products: processedProducts,
                currentPage: page,
                totalPages,
                startIndex: skip,
                endIndex: skip + products.length,
                totalProducts,
                activeProducts,
                lowStockProducts,
                topRatedProducts,
                categories,
                searchParams,
                filters: {
                    search,
                    category,
                    stock,
                    sort
                }
            });
    
        } catch (error) {
            console.error('Error in loadProductPage:', error);
            res.status(500).render('error', {
                message: 'Error loading products',
                error: process.env.NODE_ENV === 'development' ? error : {}
            });
        }
    };
    
const toggleProductStatus = async (req, res) => {
    try {
        const productId = req.params.id;
        const { isListed } = req.body;
        
        const product = await Product.findById(productId);
        
        if (!product) {
            return res.status(404).json({
                success: false,
                message: "Product not found"
            });
        }

        product.isListed = isListed;
        await product.save();

        res.json({
            success: true,
            message: `Product ${isListed ? 'listed' : 'unlisted'} successfully`
        });
    } catch (error) {
        console.error("Error toggling product status:", error);
        res.status(500).json({
            success: false,
            message: "Error updating product status"
        });
    }
};

const loadEditProduct = async (req, res) => {
    try {
        const productId = req.query.id;
        
        // Fetch product with populated fields
        const productDetails = await Product.findOne({ _id: productId })
            .populate('category')
            .populate('subcategory')
            .lean();

        if (!productDetails) {
            return res.status(404).send("Product not found.");
        }

        // Fetch all categories with their subcategories
        const categories = await Category.find({ parent: null })
            .populate('subcategories')
            .lean();

        // Format the data with proper image handling
        const formattedProduct = {
            _id: productDetails._id,
            productName: productDetails.productName,
            description: productDetails.description,
            shortDescription: productDetails.shortDescription || '',
            category: productDetails.category?._id,
            subcategory: productDetails.subcategory?._id,
            variants: productDetails.variants?.map(variant => ({
                colorValue: variant.colorValue || '',
                colorName: variant.colorName || '',
                sizes: variant.colorVariant?.map(size => ({
                    size: size.size || '',
                    stock: size.stock || 0,
                    price: size.price || 0,
                    status: size.status || 'available'
                })) || [],
                images: (variant.productImage || []).map(img => ({
                    _id: img._id || img, // Handle both object and string cases
                    url: typeof img === 'string' ? img : img.url || img
                }))
            })) || []
        };

        // Format categories
        const formattedCategories = categories.map(cat => ({
            _id: cat._id,
            name: cat.name,
            subcategories: cat.subcategories.map(sub => ({
                _id: sub._id,
                name: sub.name
            }))
        }));

        res.render("productEdit", {
            product: formattedProduct,
            categories: formattedCategories
        });

    } catch (error) {
        console.error("Error loading product:", error);
        res.status(500).send("An error occurred while loading the product.");
    }
};
const editProduct = async (req, res) => {
    try {
        const id = req.params.id;
        const productData = req.body;
        const files = req.files || [];

        console.log('Received Product Data:', JSON.stringify(productData, null, 2));
        console.log('Received Files:', files.length);

        // Validate product existence
        const existingProduct = await Product.findById(id);
        if (!existingProduct) {
            return res.status(404).json({
                success: false,
                message: "Product not found"
            });
        }

        // Parse variants data
        let variants = [];
        try {
            variants = typeof productData.variants === 'string' 
                ? JSON.parse(productData.variants) 
                : productData.variants;
        } catch (error) {
            console.error('Error parsing variants:', error);
            return res.status(400).json({
                success: false,
                message: "Invalid variants data"
            });
        }

        // Parse deleted images
        let deletedImages = [];
        try {
            deletedImages = typeof productData.deletedImages === 'string'
                ? JSON.parse(productData.deletedImages)
                : (productData.deletedImages || []);
        } catch (error) {
            console.error('Error parsing deletedImages:', error);
            deletedImages = [];
        }

        // Group files by variant index
        const filesByVariant = new Map();
        files.forEach(file => {
            const matches = file.fieldname.match(/variants\[(\d+)\]\[images\]\[(\d+)\]/);
            if (matches) {
                const variantIndex = matches[1];
                if (!filesByVariant.has(variantIndex)) {
                    filesByVariant.set(variantIndex, []);
                }
                filesByVariant.get(variantIndex).push(file);
            }
        });

        // Process variants
        const processedVariants = await Promise.all(variants.map(async (variant, index) => {
            // Get existing variant from database
            const existingVariant = existingProduct.variants[index];
            
            // Keep existing images that weren't deleted
            const existingImages = existingVariant ? existingVariant.productImage || [] : [];
            const retainedImages = existingImages.filter(img => !deletedImages.includes(img));

            // Get new images for this variant
            const variantFiles = filesByVariant.get(index.toString()) || [];
            const newImages = await Promise.all(variantFiles.map(async file => {
                try {
                    const filename = `${uuidv4()}.jpg`;
                    const imagePath = path.join('public', 'uploads', 'product-images', filename);
                    
                    await fs.promises.mkdir(path.dirname(imagePath), { recursive: true });
                    
                    await sharp(file.buffer)
                        .resize(800, 800, {
                            fit: 'cover',
                            position: 'center'
                        })
                        .toFormat('jpeg', { quality: 90 })
                        .toFile(imagePath);

                    return `/uploads/product-images/${filename}`;
                } catch (error) {
                    console.error(`Error processing image for variant ${index}:`, error);
                    throw new Error(`Failed to process image for variant ${index + 1}`);
                }
            }));

            // Combine retained and new images
            const allImages = [...retainedImages, ...newImages];

            // Only validate images if this variant is being edited
            if (variant.colorValue || variant.colorName || variant.sizes.length > 0) {
                if (allImages.length === 0) {
                    throw new Error(`At least one image is required for variant ${index + 1}`);
                }
            }

            return {
                colorValue: variant.colorValue,
                colorName: variant.colorName,
                colorVariant: variant.sizes.map(size => ({
                    size: size.size,
                    stock: parseInt(size.stock) || 0,
                    price: parseFloat(size.price) || 0,
                    status: size.status || 'available'
                })),
                productImage: allImages
            };
        }));

        // Update product
        const updatedProduct = await Product.findByIdAndUpdate(
            id,
            {
                productName: productData.productName,
                description: productData.description,
                shortDescription: productData.shortDescription || '',
                category: productData.category,
                subcategory: productData.subcategory,
                variants: processedVariants,
                searchKeywords: [
                    productData.productName,
                    ...processedVariants.map(v => v.colorName)
                ]
            },
            { new: true, runValidators: true }
        );

        // Clean up deleted images
        if (deletedImages.length > 0) {
            for (const imagePath of deletedImages) {
                try {
                    const fullPath = path.join('public', imagePath);
                    if (await fs.promises.access(fullPath).then(() => true).catch(() => false)) {
                        await fs.promises.unlink(fullPath);
                    }
                } catch (error) {
                    console.error(`Error removing file ${imagePath}:`, error);
                }
            }
        }

        return res.status(200).json({
            success: true,
            message: "Product updated successfully",
            product: updatedProduct
        });

    } catch (error) {
        console.error('Error updating product:', error);
        return res.status(500).json({
            success: false,
            message: error.message || "Error updating product"
        });
    }
};

module.exports = {
  addProducts,
  loadAddCategory,
  loadProductPage,
  toggleProductStatus,
  loadEditProduct,
  editProduct,
  
};
