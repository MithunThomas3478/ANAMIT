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
    const categories = await Category.find();
    console.log(categories,"hggg")
  
    res.render("productAdd", {
      cat: categories,
    });
  } catch (err) {
    console.log("error in loadaddcategory");
  }
};

    const addProducts = async (req, res) => {
        try {
            const productData = req.body;
            console.log("Request data:", productData);
            console.log("Files:", req.files);

            // Parse variants data
            const variants = JSON.parse(productData.variants);
            console.log("Parsed variants:", variants);

            // Check for existing product
            const existingProduct = await Product.findOne({
                productName: productData.productName
            });

            if (existingProduct) {
                return res.status(400).json({
                    success: false,
                    message: "Product already exists, please try with another name"
                });
            }

            // Validate category
            const category = await Category.findById(productData.category);
            if (!category) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid category"
                });
            }

            // Group files by variant - Updated regex pattern
            const filesByVariant = {};
            if (req.files && req.files.length > 0) {
                req.files.forEach((file) => {
                    // Updated regex to match the new field name pattern
                    const matches = file.fieldname.match(/variants\[(\d+)\]\[productImage\]\[(\d+)\]/);
                    if (matches) {
                        const variantIndex = matches[1];
                        if (!filesByVariant[variantIndex]) {
                            filesByVariant[variantIndex] = [];
                        }
                        filesByVariant[variantIndex].push(file);
                    }
                });
            }

            // Set up image processing
            const uploadDirectory = path.join("public", "uploads", "product-images");
            if (!fs.existsSync(uploadDirectory)) {
                fs.mkdirSync(uploadDirectory, { recursive: true });
            }

            // Process images and create variant structure
            const processedVariants = await Promise.all(variants.map(async (variant, variantIndex) => {
                // Process images for this variant
                const variantImages = [];
                const files = filesByVariant[variantIndex] || [];
                
                console.log(`Processing variant ${variantIndex} with ${files.length} files`);

                for (const file of files) {
                    try {
                        if (!file.buffer) {
                            throw new Error("No image buffer found");
                        }

                        const fileExtension = path.extname(file.originalname);
                        const supportedFormats = ['.jpg', '.jpeg', '.png', '.webp'];
                        if (!supportedFormats.includes(fileExtension.toLowerCase())) {
                            throw new Error("Unsupported image format");
                        }

                        const uniqueFileName = `${Date.now()}-${variantIndex}-${variantImages.length}${fileExtension}`;
                        const resizedImagePath = path.join(uploadDirectory, uniqueFileName);

                        await sharp(file.buffer, { failOnError: true })
                            .resize({
                                width: 800,
                                height: 800,
                                fit: sharp.fit.cover,
                                position: 'center'
                            })
                            .sharpen({ sigma: 1.5 })
                            .jpeg({ quality: 90 })
                            .toColourspace('srgb')
                            .toFile(resizedImagePath);

                        variantImages.push(`/uploads/product-images/${uniqueFileName}`);
                    } catch (error) {
                        console.error('Image processing error:', error);
                        throw new Error(`Failed to process image for variant ${variantIndex}: ${error.message}`);
                    }
                }

                // Structure the color variant with its sizes
                return {
                    colorValue: variant.colorValue,
                    colorName: variant.colorName,
                    colorVariant: variant.colorVariant.map(size => ({
                        size: size.size,
                        stock: parseInt(size.stock, 10),
                        price: parseFloat(size.price),
                        status: size.status || 'available'
                    })),
                    productImage: variantImages // This array should now contain the processed image paths
                };
            }));

            // Create and save the new product
            const newProduct = new Product({
                productName: productData.productName,
                description: productData.description,
                category: category._id,
                productOffer: parseFloat(productData.productOffer) || 0,
                variants: processedVariants,
                isBlocked: false,
                createdOn: new Date()
            });

            console.log('Product before validation:', JSON.stringify(newProduct, null, 2));
            await newProduct.validate(); // Validate before saving
            await newProduct.save();

            return res.status(200).json({
                success: true,
                message: "Product added successfully",
                product: newProduct
            });

        } catch (error) { 
            console.error("Error while adding product:", error);
            
            // Send appropriate error response based on error type
            if (error.name === 'ValidationError') {
                return res.status(400).json({
                    success: false,
                    message: "Validation error",
                    errors: Object.values(error.errors).map(err => err.message)
                });
            }

            return res.status(500).json({
                success: false,
                message: "Error adding product",
                error: error.message
            });
        }
    };



const loadProductPage = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = 4; // Products per page
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + limit;

    const products = await Product.find().populate("category");

    const totalPages = Math.ceil(products.length / limit);

    res.render("productManagement", {
      products,
      currentPage: page,
      totalPages,
      startIndex,
      endIndex,
    });
  } catch (error) {
    console.error(error);
    res.status(500).send("Server Error");
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
    console.log("Request Query:", req.query);
    console.log("Request Params:", req.params);
    console.log("Request Body:", req.body);

    console.log("Product ID:", productId);

    const productDetails = await Product.findOne({ _id: productId }).populate(
      "category"
    );
    console.log("product details", productDetails);

    if (!productDetails) {
      return res.status(404).send("Product not found.");
    }

    const category = await Category.find();
    console.log("category in load edt", category);

    res.render("productEdit", {
      details: productDetails,
      cat: category,
    });
  } catch (error) {
    console.error("Error loading products:", error);
    res.status(500).send("An error occurred while loading products.");
  }
};

const editProduct = async (req, res) => {
    try {
        const id = req.params.id;
        const productData = req.body;
        const files = req.files;

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
            variants = JSON.parse(productData.variants);
        } catch (error) {
            console.error('Error parsing variants:', error);
            return res.status(400).json({
                success: false,
                message: "Invalid variants data"
            });
        }

        // Parse removed images
        const removedImages = productData.removedImages ? JSON.parse(productData.removedImages) : [];

        // Process variants
        const processedVariants = await Promise.all(variants.map(async (variant, index) => {
            // Basic validation
            if (!variant.colorName?.trim() || !variant.colorValue?.trim()) {
                throw new Error(`Color information is required for variant ${index + 1}`);
            }

            // Handle variant images
            let variantImages = variant.productImage || [];
            
            // Remove any images that are in the removedImages array
            variantImages = variantImages.filter(img => !removedImages.includes(img));

            // Process new images - Fixed section
            const variantFiles = files.filter(file => 
                file.fieldname.startsWith(`variants[${index}][productImage]`)
            );

            if (variantFiles.length > 0) {
                const newImages = await Promise.all(variantFiles.map(async file => {
                    const filename = `${Date.now()}-${Math.random().toString(36).substring(7)}.jpg`;
                    const filepath = path.join('public', 'uploads', 'product-images', filename);
                    
                    await fs.promises.mkdir(path.dirname(filepath), { recursive: true });
                    
                    await sharp(file.buffer)
                        .resize(800, 800, {
                            fit: 'cover',
                            position: 'center'
                        })
                        .jpeg({ quality: 90 })
                        .toFile(filepath);

                    return `/uploads/product-images/${filename}`;
                }));

                variantImages = [...variantImages, ...newImages];
            }

            if (variantImages.length === 0) {
                throw new Error(`At least one image is required for variant ${variant.colorName}`);
            }

            return {
                colorValue: variant.colorValue.trim(),
                colorName: variant.colorName.trim(),
                colorVariant: variant.colorVariant.map(size => ({
                    size: size.size,
                    stock: Math.max(0, parseInt(size.stock) || 0),
                    price: parseFloat(size.price) || 0,
                    status: size.status || 'available'
                })),
                productImage: variantImages
            };
        }));

        // Update product
        const updatedProduct = await Product.findByIdAndUpdate(
            id,
            {
                productName: productData.productName.trim(),
                description: productData.description.trim(),
                category: productData.category,
                productOffer: Math.min(100, Math.max(0, parseFloat(productData.productOffer) || 0)),
                variants: processedVariants,
                updatedAt: new Date()
            },
            { new: true, runValidators: true }
        );

        // Clean up removed images
        if (removedImages.length > 0) {
            await Promise.allSettled(removedImages.map(async imagePath => {
                try {
                    const fullPath = path.join('public', imagePath);
                    await fs.promises.access(fullPath);
                    await fs.promises.unlink(fullPath);
                } catch (error) {
                    console.error(`Error removing file ${imagePath}:`, error);
                }
            }));
        }

        return res.status(200).json({
            success: true,
            message: "Product updated successfully 1",
            redirectUrl:"/admin/product",
            product: updatedProduct
        });

    } catch (error) {
        console.error('Error updating product:', error);
        return res.status(error.status || 500).json({
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
