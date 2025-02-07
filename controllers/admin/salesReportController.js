const User = require('../../models/userSchema');
const Order = require('../../models/orderSchema')
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const PDFDocument = require('pdfkit');
const ExcelJS = require('exceljs');
const moment = require('moment');



const getSalesReport = async (req, res) => {
    try {
        const reportType = req.params.type || 'daily';
        let startDate, endDate;
        
        // Set date range based on report type
        switch(reportType) {
            case 'daily':
                // Today
                startDate = new Date();
                startDate.setHours(0, 0, 0, 0);
                endDate = new Date();
                endDate.setHours(23, 59, 59, 999);
                break;
                
            case 'weekly':
                // Last 7 days
                startDate = new Date();
                startDate.setDate(startDate.getDate() - 7);
                startDate.setHours(0, 0, 0, 0);
                endDate = new Date();
                endDate.setHours(23, 59, 59, 999);
                break;

            case 'monthly':
                // Current month
                startDate = new Date();
                startDate.setDate(1); // First day of current month
                startDate.setHours(0, 0, 0, 0);
                endDate = new Date();
                endDate.setHours(23, 59, 59, 999);
                break;
                
            case 'yearly':
                // Current year
                startDate = new Date(new Date().getFullYear(), 0, 1); // January 1st of current year
                startDate.setHours(0, 0, 0, 0);
                endDate = new Date();
                endDate.setHours(23, 59, 59, 999);
                break;
                
            case 'custom':
                startDate = req.query.startDate ? new Date(req.query.startDate) : new Date();
                endDate = req.query.endDate ? new Date(req.query.endDate) : new Date();
                startDate.setHours(0, 0, 0, 0);
                endDate.setHours(23, 59, 59, 999);
                break;
        }

        // Get orders within date range
        const orders = await Order.find({
            createdAt: { $gte: startDate, $lte: endDate },
            orderStatus: { $nin: ['cancelled', 'failed'] }
        }).populate('items.product');

        // Calculate summary statistics
        const totalRevenue = orders.reduce((sum, order) => sum + order.finalAmount, 0);
        const totalOrders = orders.length;
        const averageOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;
        const totalProductsSold = orders.reduce((sum, order) => 
            sum + order.items.reduce((itemSum, item) => itemSum + item.quantity, 0), 0);

        // Process sales data based on report type
        const salesByDate = new Map();
        
        orders.forEach(order => {
            let dateKey;
            
            // Format date key based on report type
            switch(reportType) {
                case 'daily':
                    // Group by hour
                    dateKey = order.createdAt.toISOString().slice(0, 13); // YYYY-MM-DDTHH
                    break;
                case 'weekly':
                    // Group by day
                    dateKey = order.createdAt.toISOString().split('T')[0]; // YYYY-MM-DD
                    break;
                case 'monthly':
                    // Group by day
                    dateKey = order.createdAt.toISOString().split('T')[0];
                    break;
                case 'yearly':
                    // Group by month
                    dateKey = order.createdAt.toISOString().slice(0, 7); // YYYY-MM
                    break;
                default:
                    dateKey = order.createdAt.toISOString().split('T')[0];
            }

            const existing = salesByDate.get(dateKey) || {
                date: new Date(dateKey),
                orderCount: 0,
                productsSold: 0,
                revenue: 0,
                averageOrderValue: 0
            };

            existing.orderCount++;
            existing.productsSold += order.items.reduce((sum, item) => sum + item.quantity, 0);
            existing.revenue += order.finalAmount;
            existing.averageOrderValue = existing.revenue / existing.orderCount;

            salesByDate.set(dateKey, existing);
        });

        // Convert to array and sort by date
        const salesData = Array.from(salesByDate.values())
            .sort((a, b) => a.date - b.date);

        // Format date based on report type
        const formatDateForDisplay = (date, reportType) => {
            const d = new Date(date);
            
            switch(reportType) {
                case 'daily':
                    return d.toLocaleString('en-US', {
                        hour: '2-digit',
                        minute: '2-digit',
                        hour12: true
                    });
                case 'weekly':
                case 'monthly':
                    return d.toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric'
                    });
                case 'yearly':
                    return d.toLocaleDateString('en-US', {
                        year: 'numeric',
                        month: 'short'
                    });
                default:
                    return d.toLocaleDateString('en-US', {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric'
                    });
            }
        };

        const generatePDF = (doc, reportData) => {
            const startX = 50;
            let startY = 150;
            const rowHeight = 25;
            const colWidths = [80, 80, 120, 80, 80];
            
            // Add headers
            doc.font('Helvetica-Bold');
            ['Order Number', 'Date', 'Customer', 'Total (₹)', 'Status'].forEach((header, i) => {
                let x = startX;
                for(let j = 0; j < i; j++) x += colWidths[j];
                doc.text(header, x, startY);
            });
            
            // Add rows
            doc.font('Helvetica');
            startY += rowHeight;
            
            reportData.forEach((row, index) => {
                if (startY > 700) { // Check if we need a new page
                    doc.addPage();
                    startY = 50;
                }
                
                let x = startX;
                doc.text(row.orderNumber, x, startY);
                x += colWidths[0];
                doc.text(row.date, x, startY);
                x += colWidths[1];
                doc.text(row.customer, x, startY);
                x += colWidths[2];
                doc.text(row.total, x, startY);
                x += colWidths[3];
                doc.text(row.status, x, startY);
                
                startY += rowHeight;
            });
        };
        // Get report title
        const getReportTitle = () => {
            switch(reportType) {
                case 'daily': return 'Today\'s Sales Report';
                case 'weekly': return 'This Week\'s Sales Report';
                case 'monthly': return 'This Month\'s Sales Report';
                case 'yearly': return 'This Year\'s Sales Report';
                case 'custom': return 'Custom Period Sales Report';
                default: return 'Sales Report';
            }
        };

        // Render the report page
        res.render('admin/salesReport', {
            reportType,
            reportTitle: getReportTitle(),
            startDate: startDate.toISOString().split('T')[0],
            endDate: endDate.toISOString().split('T')[0],
            totalRevenue,
            totalOrders,
            averageOrderValue,
            totalProductsSold,
            salesData,
            formatDate
        });

    } catch (error) {
        console.error('Error generating sales report:', error);
        res.status(500).render('error', {
            message: 'Error generating sales report',
            error: process.env.NODE_ENV === 'development' ? error : {}
        });
    }
};
const exportSalesReport = async (req, res) => {
    try {
        const { format, type } = req.params;
        const { startDate, endDate } = req.query;

        // Get orders for the report
        const orders = await Order.find({
            createdAt: {
                $gte: new Date(startDate || new Date().setDate(new Date().getDate() - 30)),
                $lte: new Date(endDate || new Date())
            },
            orderStatus: { $nin: ['cancelled', 'failed'] }
        }).populate('items.product');

        // Process data for report
        const reportData = orders.map(order => ({
            orderNumber: order.orderNumber,
            date: order.createdAt.toLocaleDateString(),
            customer: order.shippingAddress.fullName,
            items: order.items.length,
            total: order.finalAmount.toFixed(2),
            status: order.orderStatus,
            payment: order.paymentMethod
        }));

        if (format === 'excel') {
            const workbook = new ExcelJS.Workbook();
            const worksheet = workbook.addWorksheet('Sales Report');

            // Add headers
            worksheet.columns = [
                { header: 'Order Number', key: 'orderNumber', width: 15 },
                { header: 'Date', key: 'date', width: 15 },
                { header: 'Customer', key: 'customer', width: 20 },
                { header: 'Items', key: 'items', width: 10 },
                { header: 'Total (₹)', key: 'total', width: 15 },
                { header: 'Status', key: 'status', width: 15 },
                { header: 'Payment Method', key: 'payment', width: 15 }
            ];

            // Add rows
            worksheet.addRows(reportData);

            // Style the header row
            worksheet.getRow(1).font = { bold: true };
            worksheet.getRow(1).fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: '4F46E5' }
            };
            worksheet.getRow(1).font = { color: { argb: 'FFFFFF' } };

            // Set response headers
            res.setHeader(
                'Content-Type',
                'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            );
            res.setHeader(
                'Content-Disposition',
                `attachment; filename=sales-report-${type}-${new Date().toISOString().split('T')[0]}.xlsx`
            );

            // Send the workbook
            await workbook.xlsx.write(res);
            res.end();

        } else if (format === 'pdf') {
            const doc = new PDFDocument();
            
            // Set response headers
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader(
                'Content-Disposition',
                `attachment; filename=sales-report-${type}-${new Date().toISOString().split('T')[0]}.pdf`
            );

            // Pipe the PDF to the response
            doc.pipe(res);

            // Add title
            doc.fontSize(16).text('Sales Report', { align: 'center' });
            doc.moveDown();

            // Add report period
            doc.fontSize(12).text(`Report Period: ${type.toUpperCase()}`, { align: 'center' });
            doc.moveDown();

            // Add table
            const table = {
                headers: ['Order Number', 'Date', 'Customer', 'Total (₹)', 'Status'],
                rows: reportData.map(row => [
                    row.orderNumber,
                    row.date,
                    row.customer,
                    row.total,
                    row.status
                ])
            };

            await doc.table(table, {
                prepareHeader: () => doc.font('Helvetica-Bold'),
                prepareRow: () => doc.font('Helvetica')
            });

            // End the document
            doc.end();
        } else {
            throw new Error('Unsupported export format');
        }

    } catch (error) {
        console.error('Error exporting sales report:', error);
        res.status(500).json({
            success: false,
            message: 'Error exporting sales report'
        });
    }
};
const formatDate = (date, reportType) => {
    if (!date) return '';
    const d = new Date(date);
    
    switch(reportType) {
        case 'daily':
            return d.toLocaleString('en-US', {
                hour: '2-digit',
                minute: '2-digit',
                hour12: true
            });
        case 'weekly':
        case 'monthly':
            return d.toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric'
            });
        case 'yearly':
            return d.toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'short'
            });
        default:
            return d.toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'short',
                day: 'numeric'
            });
    }
};

// Add this to your getSalesReport controller
const validateDateRange = (startDate, endDate) => {
    // Ensure dates are valid
    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        throw new Error('Invalid date range provided');
    }
    
    // Ensure start date is not after end date
    if (startDate > endDate) {
        throw new Error('Start date cannot be after end date');
    }
    
    // Ensure date range is not more than 1 year
    const oneYear = 365 * 24 * 60 * 60 * 1000;
    if (endDate - startDate > oneYear) {
        throw new Error('Date range cannot exceed 1 year');
    }
    
    return true;
};
module.exports ={
    getSalesReport,
    exportSalesReport
}