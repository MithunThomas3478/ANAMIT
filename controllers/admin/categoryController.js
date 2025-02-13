const Category = require("../../models/categorySchema");

const loadCategory = async (req, res) => {
    try {
        const page = parseInt(req.query.page, 10) || 1;
        const pageSize = 4;
        const skip = (page - 1) * pageSize;

        // Get men's and women's categories separately
        const [menCategories, womenCategories, totalCount] = await Promise.all([
            // Get men's category and its subcategories
            Category.findOne({ name: /^men$/i }) // Case-insensitive search for "men"
                .select('name description isListed createdAt subcategories')
                .populate({
                    path: 'subcategories',
                    select: 'name description isListed subcategories',
                    populate: {
                        path: 'subcategories',
                        select: 'name description isListed'
                    }
                })
                .lean(),

            // Get women's category and its subcategories
            Category.findOne({ name: /^women$/i }) // Case-insensitive search for "women"
                .select('name description isListed createdAt subcategories')
                .populate({
                    path: 'subcategories',
                    select: 'name description isListed subcategories',
                    populate: {
                        path: 'subcategories',
                        select: 'name description isListed'
                    }
                })
                .lean(),

            Category.countDocuments({ parent: null })
        ]);

        // Process categories to add hasSubcategories flag
        const processCategories = (category) => {
            if (!category) return null;
            return {
                ...category,
                hasSubcategories: category.subcategories && category.subcategories.length > 0,
                subcategories: category.subcategories.map(sub => ({
                    ...sub,
                    hasSubcategories: sub.subcategories && sub.subcategories.length > 0
                }))
            };
        };

        const processedMenCategory = processCategories(menCategories);
        const processedWomenCategory = processCategories(womenCategories);

        const totalPages = Math.ceil(totalCount / pageSize);
        const startIndex = (page - 1) * pageSize;
        const endIndex = Math.min(startIndex + pageSize, totalCount);

        res.render('categoryManagement', {
            menCategory: processedMenCategory,
            womenCategory: processedWomenCategory,
            currentPage: page,
            totalPages,
            pageSize,
            totalCount,
            startIndex,
            endIndex,
            error: null
        });

    } catch (error) {
        console.error('Error fetching categories:', error);
        res.render('categoryManagement', {
            menCategory: null,
            womenCategory: null,
            currentPage: 1,
            totalPages: 0,
            pageSize: 4,
            totalCount: 0,
            startIndex: 0,
            endIndex: 0,
            error: 'Failed to load categories'
        });
    }
};


const renderAddCategoryForm = (req, res) => {
    try {
      res.render('categoryAdd'); // Render the EJS form template
    } catch (error) {
      console.error('Error rendering Add Category form:', error);
      res.status(500).send('An error occurred while loading the category add form.');
    }
  };
  

  const addCategory = async (req, res) => {
    try {
        const { name, description, isListed } = req.body;
        
        // Create base slug from name
        const baseSlug = name
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/(^-|-$)/g, '');

        // Check for existing slugs
        let uniqueSlug = baseSlug;
        let count = 1;
        while (await Category.findOne({ slug: uniqueSlug })) {
            uniqueSlug = `aaaaaaaaaaa`;
            count++;
        }

        // Create new category with the generated slug
        const category = new Category({
            name,
            description,
            isListed,
            slug: uniqueSlug
        });

        await category.save();

        res.json({
            success: true,
            message: 'Category added successfully'
        });

    } catch (error) {
        console.error('Error adding category:', error);
        res.status(400).json({
            success: false,
            message: error.message || 'Error adding category'
        });
    }
};



const loadEditPage = async (req, res) => {
    try {
        const categoryId = req.params.id;
        const category = await Category.findById(categoryId);
        
        if (!category) {
            return res.redirect('/admin/categoryManagement');
        }

        res.render('categoryEdit', { category });
    } catch (error) {
        console.error('Error loading edit page:', error);
        res.redirect('/admin/categoryManagement');
    }
};

const updateCategory = async (req, res) => {
    try {
        const categoryId = req.params.id;
        const { name, description, isListed } = req.body;

        // Basic validation
        if (!name?.trim() || !description?.trim()) {
            return res.status(400).json({
                success: false,
                message: 'Name and description are required'
            });
        }

        // Find current category
        const currentCategory = await Category.findById(categoryId);
        if (!currentCategory) {
            return res.status(404).json({
                success: false,
                message: 'Category not found'
            });
        }

        // Prepare update object
        const updates = {
            name,
            description,
            isListed,
            slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
            updatedAt: new Date()
        };

        // Update category
        const updatedCategory = await Category.findByIdAndUpdate(
            categoryId,
            { $set: updates },
            { new: true, runValidators: true }
        );

        res.status(200).json({
            success: true,
            message: 'Category updated successfully',
            category: updatedCategory
        });

    } catch (error) {
        console.error('Update Error:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Error updating category'
        });
    }
};

const toggleStatus = async (req, res) => {
    try {
        const categoryId = req.params.id;
        const { isListed } = req.body;
        
        const category = await Category.findByIdAndUpdate(
            categoryId,
            { 
                isListed,
                updatedAt: new Date()
            },
            { new: true }
        );

        if (!category) {
            return res.status(404).json({
                success: false,
                message: 'Category not found'
            });
        }

        res.status(200).json({
            success: true,
            message: `Category ${isListed ? 'listed' : 'unlisted'} successfully`,
            isListed: category.isListed
        });

    } catch (error) {
        console.error('Toggle Status Error:', error);
        res.status(500).json({
            success: false,
            message: 'Error updating category status'
        });
    }
};


const deleteCategory = async (req, res) => {
        try {
            const categoryId = req.params.id;
            
            // Check if category exists
            const category = await Category.findById(categoryId);
            if (!category) {
                return res.status(404).json({
                    success: false,
                    message: 'Category not found'
                });
            }

            // Delete the category
            await Category.findByIdAndDelete(categoryId);

            return res.status(200).json({
                success: true,
                message: 'Category deleted successfully'
            });

        } catch (error) {
            console.error('Delete category error:', error);
            return res.status(500).json({
                success: false,
                message: 'Internal server error'
            });
        }
    }

    const addSubcategory = async (req, res) => {
        try {
            const parentId = req.params.parentId;
            
            // If it's a GET request, show the form
            if (req.method === 'GET') {
                const parentCategory = await Category.findById(parentId);
                if (!parentCategory) {
                    return res.redirect('/admin/category');
                }
                
                return res.render('addSubcategory', {
                    parentCategory,
                    error: null,
                    formData: null
                });
            }
            
            // If it's a POST request, handle the form submission
            const { name, description, isListed } = req.body;
            
            // Find parent category
            const parentCategory = await Category.findById(parentId);
            if (!parentCategory) {
                return res.render('addSubcategory', {
                    parentCategory: null,
                    error: 'Parent category not found',
                    formData: req.body
                });
            }
            
            // Create new subcategory
            const subcategory = new Category({
                name,
                description,
                isListed: isListed === 'on',
                parent: parentId,
                level: parentCategory.level + 1
            });
            
            // Save the subcategory
            await subcategory.save();
            
            // Update parent category's subcategories array
            await Category.findByIdAndUpdate(
                parentId,
                {
                    $addToSet: { subcategories: subcategory._id } // Using $addToSet to prevent duplicates
                },
                { new: true }
            );
            
            // Redirect to categories page
            res.redirect('/admin/category');
            
        } catch (error) {
            console.error('Error adding subcategory:', error);
            
            // Handle validation errors
            if (error.name === 'ValidationError') {
                const parentCategory = await Category.findById(req.params.parentId);
                return res.render('addSubcategory', {
                    parentCategory,
                    error: Object.values(error.errors).map(err => err.message).join(', '),
                    formData: req.body
                });
            }
            
            // Handle duplicate key errors
            if (error.code === 11000) {
                const parentCategory = await Category.findById(req.params.parentId);
                return res.render('addSubcategory', {
                    parentCategory,
                    error: 'A category with this name already exists',
                    formData: req.body
                });
            }
            
            // Handle other errors
            const parentCategory = await Category.findById(req.params.parentId);
            res.render('addSubcategory', {
                parentCategory,
                error: 'Failed to add subcategory. Please try again.',
                formData: req.body
            });
        }
    };

 module.exports = {
    loadCategory,
    renderAddCategoryForm,
    addCategory,
    updateCategory,
    loadEditPage,
    toggleStatus,
    deleteCategory,
    addSubcategory
 }