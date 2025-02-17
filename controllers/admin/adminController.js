const User = require('../../models/userSchema');
const Order = require('../../models/orderSchema');
const Product = require('../../models/productSchema');
const Category = require('../../models/categorySchema');
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const PDFDocument = require('pdfkit');
const ExcelJS = require('exceljs');
const moment = require('moment');


const pageerror = async (req,res) => {

    res.render('page_404')
    
}

const loadLogin = async     (req, res) => {
    console.log('Admin login page loaded');
    if (req.session.admin) {
        console.log('Admin already logged in. Redirecting to dashboard...');
        return res.redirect('/admin/dashboard');
    }
    res.render('logins', { message: null });
};

const adminLogin = async (req, res) => {
    try {
        console.log('Received POST request:', req.body); // Log form data
        const { email, password } = req.body;

        const admin = await User.findOne({ email, isAdmin: true });
        if (admin) {
            const passwordMatch = await bcrypt.compare(password, admin.password); // Use await!
            if (passwordMatch) {
                req.session.admin = admin._id;
                return res.redirect('/admin/dashboard');
            } else {
                return res.redirect('/admin/login?error=Invalid Password');
            }
        } else {
            return res.redirect('/admin/login?error=Admin Not Found');
        }
    } catch (error) {
        console.error('Admin login error:', error.message);
        return res.redirect('/admin/page_404');
    }
};


const logout = async (req,res) => {
    console.log('Logging out admin...')
  
    try {
        req.session.destroy(err=>{
           if(err){
            console.log('Error destroy session',err);
            return res.render('pageerror');
           } 
           res.redirect('/admin/login');
        })
    } catch (error) {
        console.log('unexpected error');
        return res.redirect('/admin/login');
    }
}


const loadDashboard = async (req, res) => {
    if (!req.session.admin) {
        return res.redirect('/admin/login');
    }

    try {
        // Basic statistics
        const totalOrders = await Order.countDocuments();
        const totalRevenue = await Order.aggregate([
            { $match: { orderStatus: { $nin: ['cancelled', 'payment_failed'] } } },
            { $group: { _id: null, total: { $sum: '$totalAmount' } } }
        ]);

        // Get top selling products with percentage
        const topProducts = await Order.aggregate([
            { $unwind: '$items' },
            { $match: { 'items.status': 'active' } },
            { 
                $group: {
                    _id: '$items.productName',
                    totalQuantity: { $sum: '$items.quantity' },
                    totalRevenue: { $sum: '$items.itemTotal' }
                }
            },
            { $sort: { totalQuantity: -1 } },
            { $limit: 5 }
        ]);

        // Calculate total quantity for percentage
        const totalQuantity = topProducts.reduce((sum, product) => sum + product.totalQuantity, 0);
        topProducts.forEach(product => {
            product.percentage = ((product.totalQuantity / totalQuantity) * 100).toFixed(1);
        });

        // Get top selling categories with percentage
        const topCategories = await Order.aggregate([
            { $unwind: '$items' },
            { $match: { 'items.status': 'active' } },
            { 
                $group: {
                    _id: '$items.category', // Make sure your items have category field
                    totalQuantity: { $sum: '$items.quantity' },
                    totalRevenue: { $sum: '$items.itemTotal' }
                }
            },
            { $sort: { totalQuantity: -1 } },
            { $limit: 5 }
        ]);

        // Calculate total quantity for categories percentage
        const totalCategoryQuantity = topCategories.reduce((sum, category) => sum + category.totalQuantity, 0);
        topCategories.forEach(category => {
            category.percentage = ((category.totalQuantity / totalCategoryQuantity) * 100).toFixed(1);
        });

        // Get monthly sales data for initial graph
        const monthlySales = await Order.aggregate([
            {
                $match: {
                    orderStatus: { $nin: ['cancelled', 'payment_failed'] },
                    createdAt: { 
                        $gte: new Date(new Date().setMonth(new Date().getMonth() - 11)) 
                    }
                }
            },
            {
                $group: {
                    _id: {
                        month: { $month: '$createdAt' },
                        year: { $year: '$createdAt' }
                    },
                    totalSales: { $sum: '$totalAmount' },
                    orderCount: { $sum: 1 }
                }
            },
            { $sort: { '_id.year': 1, '_id.month': 1 } }
        ]);

        res.render('adminDashboard', {
            totalOrders,
            totalRevenue: totalRevenue[0]?.total || 0,
            topProducts,
            topCategories,
            monthlySales
        });

    } catch (error) {
        console.error('Error loading dashboard:', error);
        res.redirect('/admin/page_404');
    }
};

// API endpoint for graph data
// Backend: Update the getGraphData function
const getGraphData = async (req, res) => {
    try {
        const { timeRange, startDate, endDate } = req.query;
        let dateFilter = {};
        let groupByFormat;

        switch(timeRange) {
            case 'daily':
                dateFilter = { 
                    createdAt: { 
                        $gte: new Date(new Date().setHours(0,0,0,0))
                    }
                };
                groupByFormat = { 
                    hour: { $hour: '$createdAt' },
                    date: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }
                };
                break;

            case 'weekly':
                dateFilter = {
                    createdAt: {
                        $gte: new Date(new Date().setDate(new Date().getDate() - 7))
                    }
                };
                groupByFormat = { 
                    day: { $dayOfWeek: '$createdAt' },
                    date: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }
                };
                break;

            case 'monthly':
                dateFilter = {
                    createdAt: {
                        $gte: new Date(new Date().setMonth(new Date().getMonth() - 1))
                    }
                };
                groupByFormat = { 
                    date: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }
                };
                break;

            case 'yearly':
                dateFilter = {
                    createdAt: {
                        $gte: new Date(new Date().setFullYear(new Date().getFullYear() - 1))
                    }
                };
                groupByFormat = { 
                    date: { $dateToString: { format: '%Y-%m', date: '$createdAt' } }
                };
                break;

            case 'custom':
                if (startDate && endDate) {
                    dateFilter = {
                        createdAt: {
                            $gte: new Date(startDate),
                            $lte: new Date(endDate)
                        }
                    };
                    groupByFormat = { 
                        date: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }
                    };
                }
                break;
        }

        const salesData = await Order.aggregate([
            { 
                $match: { 
                    ...dateFilter,
                    orderStatus: { $nin: ['cancelled', 'payment_failed'] }
                }
            },
            {
                $group: {
                    _id: groupByFormat,
                    revenue: { $sum: '$totalAmount' },
                    orders: { $sum: 1 }
                }
            },
            { $sort: { '_id.date': 1 } }
        ]);

        res.json(salesData);
    } catch (error) {
        console.error('Error fetching graph data:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

// Frontend: Update the chart initialization code
function initializeChart(data) {
    const ctx = document.getElementById('salesChart').getContext('2d');
    
    if (salesChart) {
        salesChart.destroy();
    }

    // Format dates based on time range
    const timeRange = document.getElementById('timeRange').value;
    const labels = data.map(item => {
        const date = item._id.date;
        if (!date) return '';
        
        switch(timeRange) {
            case 'daily':
                return moment(date).format('HH:mm');
            case 'weekly':
                return moment(date).format('MMM DD');
            case 'monthly':
                return moment(date).format('MMM DD');
            case 'yearly':
                return moment(date).format('MMM YYYY');
            case 'custom':
                return moment(date).format('MMM DD, YYYY');
            default:
                return date;
        }
    });

    salesChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Revenue',
                data: data.map(item => item.revenue),
                borderColor: 'rgb(75, 192, 192)',
                tension: 0.1,
                yAxisID: 'y'
            }, {
                label: 'Orders',
                data: data.map(item => item.orders),
                borderColor: 'rgb(255, 99, 132)',
                tension: 0.1,
                yAxisID: 'y1'
            }]
        },
        options: {
            responsive: true,
            interaction: {
                mode: 'index',
                intersect: false,
            },
            scales: {
                y: {
                    type: 'linear',
                    display: true,
                    position: 'left',
                    title: {
                        display: true,
                        text: 'Revenue (₹)'
                    }
                },
                y1: {
                    type: 'linear',
                    display: true,
                    position: 'right',
                    title: {
                        display: true,
                        text: 'Number of Orders'
                    },
                    grid: {
                        drawOnChartArea: false
                    }
                }
            }
        }
    });
}

module.exports = {
    loadLogin,
    adminLogin,
    loadDashboard,
    pageerror,
    logout,
    getGraphData
  
}

