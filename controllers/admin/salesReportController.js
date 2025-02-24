const User = require('../../models/userSchema');
const Order = require('../../models/orderSchema');
const PDFDocument = require('pdfkit');
const ExcelJS = require('exceljs');
const moment = require('moment');
const lodash = require('lodash'); 
const Category = require('../../models/categorySchema');
const Product = require('../../models/productSchema');
// Get sales report
const getSalesReport = async (req, res) => {
    try {
        const reportType = req.params.type || 'today';
        let startDate, endDate;
        
        // Set date range based on report type
        switch(reportType) {
            case 'today':
                startDate = moment().startOf('day').toDate();
                endDate = moment().endOf('day').toDate();
                break;
                
            case 'weekly':
                startDate = moment().subtract(6, 'days').startOf('day').toDate();
                endDate = moment().endOf('day').toDate();
                break;

            case 'monthly':
                startDate = moment().startOf('month').toDate();
                endDate = moment().endOf('month').toDate();
                break;

            case 'yearly':
                startDate = moment().startOf('year').toDate();
                endDate = moment().endOf('year').toDate();
                break;
                
            case 'custom':
                if (!req.query.startDate || !req.query.endDate) {
                    startDate = moment().subtract(30, 'days').startOf('day').toDate();
                    endDate = moment().endOf('day').toDate();
                } else {
                    startDate = moment(req.query.startDate).startOf('day').toDate();
                    endDate = moment(req.query.endDate).endOf('day').toDate();
                }
                break;

            default:
                startDate = moment().startOf('day').toDate();
                endDate = moment().endOf('day').toDate();
        }

        // Validate date range
        validateDateRange(startDate, endDate);

        // Get ONLY DELIVERED orders within date range
        const orders = await Order.find({
            createdAt: { $gte: startDate, $lte: endDate },
            orderStatus: 'delivered'  // Only include delivered orders
        }).populate('items.product user');

        // Calculate summary statistics
        const totalRevenue = orders.reduce((sum, order) => sum + (Number(order.finalAmount) || 0), 0);
        const totalOrders = orders.length;
        const averageOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;
        const totalProductsSold = orders.reduce((sum, order) => 
            sum + order.items.reduce((itemSum, item) => itemSum + (Number(item.quantity) || 0), 0), 0);

        // Process sales data based on report type
        const salesByDate = new Map();
        
        orders.forEach(order => {
            let dateKey;
            const orderDate = new Date(order.actualDelivery || order.createdAt);
            
            switch(reportType) {
                case 'today':
                    dateKey = moment(orderDate).format('HH:00'); // Group by hour
                    break;
                case 'weekly':
                case 'monthly':
                    dateKey = moment(orderDate).format('YYYY-MM-DD'); // Group by day
                    break;
                case 'yearly':
                    dateKey = moment(orderDate).format('YYYY-MM'); // Group by month
                    break;
                default:
                    dateKey = moment(orderDate).format('YYYY-MM-DD');
            }

            const existing = salesByDate.get(dateKey) || {
                date: orderDate,
                orderCount: 0,
                productsSold: 0,
                revenue: 0,
                averageOrderValue: 0,
                paymentMethods: {
                    cod: 0,
                    razorpay: 0,
                    wallet: 0
                }
            };

            const orderRevenue = Number(order.finalAmount) || 0;
            const orderProductsSold = order.items.reduce((sum, item) => 
                sum + (Number(item.quantity) || 0), 0);

            existing.orderCount++;
            existing.productsSold += orderProductsSold;
            existing.revenue += orderRevenue;
            existing.averageOrderValue = existing.revenue / existing.orderCount;
            existing.paymentMethods[order.paymentMethod]++;

            salesByDate.set(dateKey, existing);
        });

        // Convert to array and sort by date
        const salesData = Array.from(salesByDate.values())
            .sort((a, b) => a.date - b.date)
            .map(data => ({
                ...data,
                revenue: Number(data.revenue) || 0,
                averageOrderValue: Number(data.averageOrderValue) || 0,
                productsSold: Number(data.productsSold) || 0
            }));

        // Calculate payment method statistics
        const paymentMethodStats = orders.reduce((stats, order) => {
            stats[order.paymentMethod] = (stats[order.paymentMethod] || 0) + 1;
            return stats;
        }, {});

        // Calculate top selling products
        const productSales = new Map();
        orders.forEach(order => {
            order.items.forEach(item => {
                const existing = productSales.get(item.productId) || {
                    productName: item.productName,
                    quantity: 0,
                    revenue: 0
                };
                existing.quantity += item.quantity;
                existing.revenue += item.itemTotal;
                productSales.set(item.productId, existing);
            });
        });

        const topProducts = Array.from(productSales.values())
            .sort((a, b) => b.quantity - a.quantity)
            .slice(0, 5);

        res.render('admin/salesReport', {
            reportType,
            startDate: startDate.toISOString().split('T')[0],
            endDate: endDate.toISOString().split('T')[0],
            totalRevenue,
            totalOrders,
            averageOrderValue,
            totalProductsSold,
            salesData,
            paymentMethodStats,
            topProducts,
            formatDate: (date) => formatDate(date, reportType),
            formatCurrency: (amount) => formatCurrency(amount)
        });

    } catch (error) {
        console.error('Error generating sales report:', error);
        res.status(500).render('error', {
            message: 'Error generating sales report',
            error: process.env.NODE_ENV === 'development' ? error : {}
        });
    }
};

// Export sales report
const exportSalesReport = async (req, res) => {
    try {
        const { format, type } = req.params;
        const { startDate: queryStartDate, endDate: queryEndDate } = req.query;

        // Determine date range
        let startDate, endDate;
        switch(type) {
            case 'today':
                startDate = moment().startOf('day').toDate();
                endDate = moment().endOf('day').toDate();
                break;
            case 'weekly':
                startDate = moment().subtract(6, 'days').startOf('day').toDate();
                endDate = moment().endOf('day').toDate();
                break;
            case 'monthly':
                startDate = moment().startOf('month').toDate();
                endDate = moment().endOf('month').toDate();
                break;
            case 'yearly':
                startDate = moment().startOf('year').toDate();
                endDate = moment().endOf('year').toDate();
                break;
            case 'custom':
                startDate = moment(queryStartDate).startOf('day').toDate();
                endDate = moment(queryEndDate).endOf('day').toDate();
                break;
            default:
                startDate = moment().startOf('day').toDate();
                endDate = moment().endOf('day').toDate();
        }

        // Get orders
        const orders = await Order.find({
            createdAt: { $gte: startDate, $lte: endDate },
            orderStatus: 'delivered'  // Only include delivered orders
        }).populate('items.product user');

        // Calculate summary statistics
        const totalRevenue = orders.reduce((sum, order) => sum + (Number(order.finalAmount) || 0), 0);
        const totalOrders = orders.length;
        const averageOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;
        const totalProductsSold = orders.reduce((sum, order) => 
            sum + order.items.reduce((itemSum, item) => itemSum + (Number(item.quantity) || 0), 0), 0);

        if (format === 'pdf') {
            await generatePDF(res, {
                orders,
                type,
                startDate,
                endDate,
                totalRevenue,
                totalOrders,
                averageOrderValue,
                totalProductsSold
            });
        } else if (format === 'excel') {
            await generateExcel(res, {
                orders,
                type,
                startDate,
                endDate,
                totalRevenue,
                totalOrders,
                averageOrderValue,
                totalProductsSold
            });
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

function capitalizeFirstLetter(string) {
    return string.charAt(0).toUpperCase() + string.slice(1);
}

// Helper function to generate professional PDF report
async function generatePDF(res, data) {
    const doc = new PDFDocument({
        size: 'A4',
        margin: 50,
        bufferPages: true
    });

    // Set response headers
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
        'Content-Disposition',
        `attachment; filename=ANAMIT_Sales_Report_${moment().format('DDMMYYYY')}.pdf`
    );

    doc.pipe(res);

    // Define standard formatting
    const tableWidth = 500;
    const cellPadding = 8;
    const lineHeight = 20;
    const tableLeft = 50;
    const tableRight = tableLeft + tableWidth;

    // Add letterhead
    doc.fontSize(22)
       .font('Helvetica-Bold')
       .text('ANAMIT', 50, 50);

    doc.fontSize(10)
       .font('Helvetica')
       .text('www.anamit.com', 50, 75);

    // Add report title and details
    doc.moveDown(3);
    doc.fontSize(16)
       .font('Helvetica-Bold')
       .text('SALES REPORT', { align: 'center' });

    doc.moveDown(0.5);
    doc.fontSize(10)
       .font('Helvetica')
       .text(`Report Period: ${moment(data.startDate).format('DD/MM/YYYY')} to ${moment(data.endDate).format('DD/MM/YYYY')}`, { align: 'center' });

    // Add summary box
    doc.moveDown(2);
    const summaryY = doc.y;
    const summaryHeight = 100;
    const colWidth = tableWidth / 4;

    // Draw summary box outline
    doc.rect(tableLeft, summaryY, tableWidth, summaryHeight)
       .stroke();

    // Add summary data
    const summaryData = [
        { label: 'Total Orders', value: data.totalOrders },
        { label: 'Products Sold', value: data.totalProductsSold },
        { label: 'Total Revenue', value: `${formatNumber(data.totalRevenue)}` },
        { label: 'Average Order Value', value: `${formatNumber(data.averageOrderValue)}` }
    ];

    summaryData.forEach((item, index) => {
        const x = tableLeft + (colWidth * index);
        const textX = x + cellPadding;

        // Add vertical divider (except for last column)
        if (index < summaryData.length - 1) {
            doc.moveTo(x + colWidth, summaryY)
               .lineTo(x + colWidth, summaryY + summaryHeight)
               .stroke();
        }

        // Add label
        doc.font('Helvetica')
           .fontSize(10)
           .text(item.label, textX, summaryY + cellPadding);

        // Add value
        doc.font('Helvetica-Bold')
           .fontSize(12)
           .text(item.value, textX, summaryY + 40);
    });

    // Orders table
    doc.moveDown(4);
    const tableTop = doc.y + 30;
    let currentY = tableTop;

    // Table headers
    const headers = [
        { label: 'Order ID', width: 90 },
        { label: 'Date', width: 80 },
        { label: 'Customer', width: 140 },
        { label: 'Items', width: 50, align: 'center' },
        { label: 'Amount', width: 80, align: 'right' },
        { label: 'Status', width: 60 }
    ];

    // Draw header background
    doc.rect(tableLeft, currentY - 5, tableWidth, lineHeight)
       .fill('#f4f4f4');

    // Add headers
    let currentX = tableLeft;
    headers.forEach(header => {
        doc.font('Helvetica-Bold')
           .fontSize(10)
           .fillColor('#000000')
           .text(
               header.label,
               currentX + cellPadding,
               currentY,
               {
                   width: header.width - (cellPadding * 2),
                   align: header.align || 'left'
               }
           );
        currentX += header.width;
    });

    currentY += lineHeight + 5;

    // Add rows
    data.orders.forEach((order, index) => {
        // Check for page break
        if (currentY > doc.page.height - 100) {
            doc.addPage();
            currentY = 50;
        }

        // Draw row background (alternate)
        if (index % 2 === 0) {
            doc.rect(tableLeft, currentY - 5, tableWidth, lineHeight)
               .fill('#fafafa');
        }

        // Add row data
        currentX = tableLeft;
        const rowData = [
            { value: order.orderNumber, width: headers[0].width },
            { value: moment(order.createdAt).format('DD/MM/YYYY'), width: headers[1].width },
            { value: order.shippingAddress.fullName, width: headers[2].width },
            { value: order.items.length.toString(), width: headers[3].width, align: 'center' },
            { value: `${formatNumber(order.finalAmount)}`, width: headers[4].width, align: 'right' },
            { value: capitalizeFirstLetter(order.orderStatus), width: headers[5].width }
        ];

        rowData.forEach(cell => {
            doc.font('Helvetica')
               .fontSize(9)
               .fillColor('#000000')
               .text(
                   cell.value,
                   currentX + cellPadding,
                   currentY,
                   {
                       width: cell.width - (cellPadding * 2),
                       align: cell.align || 'left'
                   }
               );
            currentX += cell.width;
        });

        currentY += lineHeight;
    });

    // Add page numbers
    const pageCount = doc.bufferedPageRange().count;
    for (let i = 0; i < pageCount; i++) {
        doc.switchToPage(i);
        doc.fontSize(8)
           .text(
               `Page ${i + 1} of ${pageCount}`,
               50,
               doc.page.height - 50,
               { align: 'right' }
           );
    }

    // Add footer
    doc.fontSize(8)
       .text(
           'This is a computer-generated document. No signature is required.',
           50,
           doc.page.height - 30,
           { align: 'center' }
       );

    doc.end();
}

async function generateExcel(res, data) {
    try {
        const workbook = new ExcelJS.Workbook();
        workbook.creator = 'ANAMIT';
        workbook.created = new Date();
        workbook.modified = new Date();

        const worksheet = workbook.addWorksheet('Sales Report', {
            pageSetup: { 
                paperSize: 9, // A4
                orientation: 'portrait',
                fitToPage: true,
                margins: {
                    left: 0.7, right: 0.7,
                    top: 0.75, bottom: 0.75,
                    header: 0.3, footer: 0.3
                }
            }
        });

        // Set column widths
        worksheet.columns = [
            { width: 15 },  // Order ID
            { width: 15 },  // Date
            { width: 25 },  // Customer
            { width: 10 },  // Items
            { width: 15 },  // Amount
            { width: 15 }   // Status
        ];

        // Add header
        worksheet.mergeCells('A1:F1');
        const titleCell = worksheet.getCell('A1');
        titleCell.value = 'ANAMIT SALES REPORT';
        titleCell.font = { size: 16, bold: true, name: 'Helvetica' };
        titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
        
        worksheet.mergeCells('A2:F2');
        const periodCell = worksheet.getCell('A2');
        periodCell.value = `Period: ${moment(data.startDate).format('DD/MM/YYYY')} to ${moment(data.endDate).format('DD/MM/YYYY')}`;
        periodCell.font = { size: 12, name: 'Helvetica' };
        periodCell.alignment = { horizontal: 'center', vertical: 'middle' };

        // Summary section
        worksheet.addRow([]); // Empty row
        worksheet.mergeCells('A4:F4');
        worksheet.getCell('A4').value = 'Summary';
        worksheet.getCell('A4').font = { size: 14, bold: true, name: 'Helvetica' };
        
        // Summary data
        const summaryData = [
            ['Total Orders', data.totalOrders],
            ['Products Sold', data.totalProductsSold],
            ['Total Revenue', formatCurrency(data.totalRevenue)],
            ['Average Order Value', formatCurrency(data.averageOrderValue)]
        ];

        summaryData.forEach((row, index) => {
            const rowNum = 5 + index;
            worksheet.getCell(`A${rowNum}`).value = row[0];
            worksheet.getCell(`B${rowNum}`).value = row[1];
            
            // Styling
            worksheet.getCell(`A${rowNum}`).font = { name: 'Helvetica', bold: true };
            worksheet.getCell(`B${rowNum}`).font = { name: 'Helvetica' };
            worksheet.getCell(`A${rowNum}`).alignment = { vertical: 'middle' };
            worksheet.getCell(`B${rowNum}`).alignment = { vertical: 'middle' };
            
            // Add borders
            ['A', 'B'].forEach(col => {
                const cell = worksheet.getCell(`${col}${rowNum}`);
                cell.border = {
                    top: { style: 'thin' },
                    left: { style: 'thin' },
                    bottom: { style: 'thin' },
                    right: { style: 'thin' }
                };
            });
        });

        // Add table header
        worksheet.addRow([]); // Empty row
        const headerRow = worksheet.addRow([
            'Order ID',
            'Date',
            'Customer',
            'Items',
            'Amount',
            'Status'
        ]);

        // Style header
        headerRow.eachCell((cell) => {
            cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, name: 'Helvetica' };
            cell.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FF4F46E5' }
            };
            cell.border = {
                top: { style: 'thin' },
                left: { style: 'thin' },
                bottom: { style: 'thin' },
                right: { style: 'thin' }
            };
            cell.alignment = { vertical: 'middle', horizontal: 'center' };
        });

        // Add order data
        data.orders.forEach((order) => {
            const row = worksheet.addRow([
                order.orderNumber,
                moment(order.createdAt).format('DD/MM/YYYY'),
                order.shippingAddress.fullName,
                order.items.length,
                formatCurrency(order.finalAmount),
                capitalizeFirstLetter(order.orderStatus)
            ]);

            row.eachCell((cell) => {
                cell.font = { name: 'Helvetica' };
                cell.border = {
                    top: { style: 'thin' },
                    left: { style: 'thin' },
                    bottom: { style: 'thin' },
                    right: { style: 'thin' }
                };
                cell.alignment = { vertical: 'middle' };
            });

            // Right align amount
            worksheet.getCell(`E${row.number}`).alignment = { horizontal: 'right' };
            // Center align items
            worksheet.getCell(`D${row.number}`).alignment = { horizontal: 'center' };
        });

        // Add totals row
        worksheet.addRow([]); // Empty row
        const totalRow = worksheet.addRow([
            'Total',
            '',
            '',
            data.totalOrders,
            formatCurrency(data.totalRevenue),
            ''
        ]);

        totalRow.eachCell((cell) => {
            cell.font = { bold: true, name: 'Helvetica' };
            cell.border = {
                top: { style: 'thin' },
                left: { style: 'thin' },
                bottom: { style: 'thin' },
                right: { style: 'thin' }
            };
            cell.alignment = { vertical: 'middle' };
        });

        worksheet.getCell(`D${totalRow.number}`).alignment = { horizontal: 'center' };
        worksheet.getCell(`E${totalRow.number}`).alignment = { horizontal: 'right' };

        // Add footer
        worksheet.addRow([]); // Empty row
        worksheet.mergeCells(`A${worksheet.rowCount + 1}:F${worksheet.rowCount + 1}`);
        const footerCell = worksheet.getCell(`A${worksheet.rowCount + 1}`);
        footerCell.value = 'This is a computer-generated document. No signature is required.';
        footerCell.font = { size: 8, name: 'Helvetica' };
        footerCell.alignment = { horizontal: 'center' };

        // Set explicit headers for Excel .xlsx format
        res.setHeader(
            'Content-Type',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        );
        res.setHeader(
            'Content-Disposition',
            `attachment; filename="ANAMIT_Sales_Report_${moment().format('DDMMYYYY')}.xlsx"`
        );

        // Generate buffer and send as response
        const buffer = await workbook.xlsx.writeBuffer();
        res.setHeader('Content-Length', buffer.length); // Optional: helps browser show download progress
        res.send(buffer);

    } catch (error) {
        console.error('Error generating Excel report:', error);
        throw error;
    }
}


// Helper function to format numbers
function formatNumber(number) {
    return new Intl.NumberFormat('en-IN', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }).format(number);
}


// Utility function to format date
function formatDate(date, reportType) {
if (!date) return '';

switch(reportType) {
case 'today':
return moment(date).format('hh:mm A');
case 'weekly':
case 'monthly':
return moment(date).format('MMM D, YYYY');
case 'yearly':
return moment(date).format('MMMM YYYY');
case 'custom':
return moment(date).format('MMM D, YYYY');
default:
return moment(date).format('MMM D, YYYY');
}
}

// Utility function to format currency
function formatCurrency(amount) {
return new Intl.NumberFormat('en-IN', {
style: 'currency',
currency: 'INR',
minimumFractionDigits: 2,
maximumFractionDigits: 2
}).format(amount || 0);
}

// Utility function to validate date range
function validateDateRange(startDate, endDate) {
if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
throw new Error('Invalid date range provided');
}

if (startDate > endDate) {
throw new Error('Start date cannot be after end date');
}

const diffTime = Math.abs(endDate - startDate);
const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

if (diffDays > 365) {
throw new Error('Date range cannot exceed 1 year');
}

return true;
}

// Utility function to get chart data
function getChartData(salesData, reportType) {
const labels = salesData.map(data => formatDate(data.date, reportType));
const revenueData = salesData.map(data => data.revenue);
const ordersData = salesData.map(data => data.orderCount);

return {
labels,
datasets: [
{
    label: 'Revenue',
    data: revenueData,
    borderColor: '#4F46E5',
    tension: 0.4
},
{
    label: 'Orders',
    data: ordersData,
    borderColor: '#10B981',
    tension: 0.4
}
]
};
}

// Export all functions
module.exports = {
getSalesReport,
exportSalesReport,
formatDate,
formatCurrency,
validateDateRange,
getChartData,
generateExcel
};

// Helper function to get report title
function getReportTitle(reportType) {
switch(reportType) {
case 'today':
return 'Today\'s Sales Report';
case 'weekly':
return 'Last 7 Days Sales Report';
case 'monthly':
return 'This Month\'s Sales Report';
case 'yearly':
return 'This Year\'s Sales Report';
case 'custom':
return 'Custom Period Sales Report';
default:
return 'Sales Report';
}
}

// Helper function to get formatted date range
function getDateRangeText(startDate, endDate, reportType) {
switch(reportType) {
case 'today':
return moment(startDate).format('MMMM D, YYYY');
case 'weekly':
return `${moment(startDate).format('MMM D')} - ${moment(endDate).format('MMM D, YYYY')}`;
case 'monthly':
return moment(startDate).format('MMMM YYYY');
case 'yearly':
return moment(startDate).format('YYYY');
case 'custom':
return `${moment(startDate).format('MMM D, YYYY')} - ${moment(endDate).format('MMM D, YYYY')}`;
default:
return `${moment(startDate).format('MMM D, YYYY')} - ${moment(endDate).format('MMM D, YYYY')}`;
}
}