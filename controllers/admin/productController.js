const fs = require("fs");
const path = require("path");
const sharp = require("sharp");
const User = require("../../models/userSchema");
const Category = require("../../models/categorySchema");
const Product = require("../../models/productSchema");
const { v4: uuidv4 } = require("uuid");

const loadAddCategory = async (req, res) => {
  try {
    const categories = await Category.find();
    res.render("productAdd", {
      cat: categories,
    });
  } catch (err) {
    console.log("error in loadaddcategory");
  }
};

const addProducts = async (req, res) => {
  try {
    console.log("files", req.files);
    const productData = req.body;
    console.log("data", productData);

    const variant = JSON.parse(productData.variants);
    console.log("body", variant);

    // Group files by variant
    const filesByVariant = {};
    if (req.files && req.files.length > 0) {
      req.files.forEach((file) => {
        const matches = file.fieldname.match(/^productImages\[(\d+)\]/);
        if (matches) {
          const variantIndex = matches[1];
          if (!filesByVariant[variantIndex]) {
            filesByVariant[variantIndex] = [];
          }
          filesByVariant[variantIndex].push(file);
        }
      });
    }

    const existingProduct = await Product.findOne({
      productName: productData.productName,
    });

    if (existingProduct) {
      return res
        .status(400)
        .json("Product already exists, please try with another name");
    }

    // Process images for each variant
    const processedImages = {};
    const uploadDirectory = path.join("public", "uploads", "product-images");

    if (!fs.existsSync(uploadDirectory)) {
      fs.mkdirSync(uploadDirectory, { recursive: true });
    }

    // Process images by variant
    for (const [variantIndex, files] of Object.entries(filesByVariant)) {
      processedImages[variantIndex] = [];
      for (let i = 0; i < files.length; i++) {
        try {
          const file = files[i];
          // Verify that we have valid image data
          if (!file.buffer) {
            throw new Error("No image buffer found");
          }

          const fileExtension = path.extname(file.originalname);
          const uniqueFileName = `${Date.now()}-${variantIndex}-${i}${fileExtension}`;
          const resizedImagePath = path.join(uploadDirectory, uniqueFileName);

          // Add error handling and validation before processing
          const supportedFormats = [".jpg", ".jpeg", ".png", ".webp"];
          if (!supportedFormats.includes(fileExtension.toLowerCase())) {
            throw new Error("Unsupported image format");
          }

          // Process the image with additional error handling
          await sharp(file.buffer, { failOnError: true })
            .resize({ width: 440, height: 440, fit: sharp.fit.cover })
            .sharpen({ sigma: 1.5 })
            .jpeg({ quality: 95 })
            .toColourspace("srgb")
            .toFile(resizedImagePath)
            .catch((err) => {
              console.error("Sharp processing error:", err);
              throw new Error("Image processing failed");
            });

          processedImages[variantIndex].push(
            `/uploads/product-images/${uniqueFileName}`
          );
        } catch (imageError) {
          console.error("Error processing image:", imageError);
          return res.status(500).json("Error processing image");
        }
      }
    }

    const category = await Category.findOne({ name: productData.category });
    console.log("category is", category);

    if (!category) {
      return res.status(400).json("Invalid category name");
    }

    // Map variants with their processed images
    const variantsWithImages = variant.map((variantData, index) => ({
      color: variantData.color,
      colorName: variantData.colorName,
      size: variantData.size,
      stock: parseInt(variantData.stock, 10),
      price: parseFloat(variantData.price),
      productImage: processedImages[index] || [],
    }));

    const newProduct = new Product({
      productName: productData.productName,
      description: productData.description,
      category: category._id,
      productOffer: productData.productOffer || 0,
      variants: variantsWithImages,
      status: productData.status || "Available",
      createdOn: new Date(),
    });

    await newProduct.save();
    return res
      .status(200)
      .json({ success: true, message: "product added successfully" });
  } catch (error) {
    console.error("Error while adding product:", error.message, error.stack);
    return res.status(500).json("Error adding product");
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
    const product = await Product.findById(productId);

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    product.isBlocked = !product.isBlocked;
    await product.save();

    res.json({
      success: true,
      message: `product ${
        product.isBlocked ? "unlisted" : "listed"
      } successfully`,
    });
  } catch (error) {
    console.error("Error toggling product status:", error);
    res.status(500).json({
      success: false,
      message: "Error updating product status",
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
    const uploadedFiles = req.files || [];
    console.log(uploadedFiles, "aaa");

    // Helper function to parse JSON safely
    const parseJSON = (data, defaultValue) => {
      try {
        return Array.isArray(data) ? data : JSON.parse(data || "[]");
      } catch (error) {
        console.error("Error parsing JSON:", error);
        return defaultValue;
      }
    };

    const variants = parseJSON(productData.variants, []);
    const removedImages = parseJSON(productData.removedImages, []);
    console.log("vari", variants);
    // return res.redirect("/admin/product");

    // Process variants
    const processVariantImages = async (variantData, index) => {
      const existingImages = parseJSON(variantData.existingImages, []);
      let variantImages =
        existingImages.filter((img) => img && !removedImages.includes(img)) ||
        [];

      // Handle new uploaded files for this variant
      const variantFiles = uploadedFiles.filter(
        (file) => file.fieldname === `productImages[${index}]`
      );

      for (const file of variantFiles) {
        try {
          const filename = `${uuidv4()}.jpg`;
          const filepath = path.join("public/uploads/product-images", filename);

          // Ensure directory exists
          await fs.promises.mkdir(path.dirname(filepath), { recursive: true });

          // Process and save image
          await sharp(file.buffer)
            .resize(800, 800, { fit: "cover" })
            .jpeg({ quality: 90 })
            .toFile(filepath);

          const imagePath = `/uploads/product-images/${filename}`;
          variantImages.push(imagePath);
        } catch (error) {
          console.error("Error processing image:", error);
        }
      }

      return variantImages;
    };

    const processedVariants = await Promise.all(
      variants.map(async (variantData, index) => ({
        color: variantData.color,
        colorName: variantData.colorName,
        size: variantData.size,
        stock: parseInt(variantData.stock) || 0,
        price: parseFloat(variantData.price) || 0,
        productImage: await processVariantImages(variantData, index),
        status: parseInt(variantData.stock) > 0 ? "Available" : "Out of Stock",
      }))
    );

    // Update the product
    const updatedProduct = await Product.findByIdAndUpdate(
      id,
      {
        $set: {
          productName: productData.productName,
          description: productData.description,
          category: productData.category,
          variants: processedVariants,
          status: processedVariants.some((v) => v.stock > 0)
            ? "Available"
            : "Out of Stock",
        },
      },
      { new: true }
    );

    if (!updatedProduct) {
      return res.status(404).json({
        success: false,
        message: "Failed to update product. Product not found.",
      });
    }

    // Remove unused images
    await Promise.all(
      removedImages.map(async (imagePath) => {
        try {
          const fullPath = path.join("public", imagePath);
          if (
            await fs.promises
              .access(fullPath)
              .then(() => true)
              .catch(() => false)
          ) {
            await fs.promises.unlink(fullPath);
          }
        } catch (error) {
          console.error("Error removing image file:", error);
        }
      })
    );

    return res.redirect("/admin/product");
  } catch (error) {
    console.error("Error updating product:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
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
