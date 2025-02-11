const User = require('../../models/userSchema');
const Order = require('../../models/orderSchema');
const PDFDocument = require('pdfkit');
const ExcelJS = require('exceljs');
const moment = require('moment');
const lodash = require('lodash'); 

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

// Helper function to generate professional Excel report
async function generateExcel(res, data) {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'ANAMIT';
    workbook.created = new Date();

    const worksheet = workbook.addWorksheet('Sales Report', {
        pageSetup: {
            paperSize: 9,
            orientation: 'landscape',
            fitToPage: true,
            fitToWidth: 1,
            fitToHeight: 0
        }
    });

    // Set print area
    worksheet.pageSetup.printArea = 'A1:G50';

    // Column definitions
    worksheet.columns = [
        { header: 'Order ID', key: 'orderId', width: 15 },
        { header: 'Date', key: 'date', width: 12 },
        { header: 'Customer', key: 'customer', width: 30 },
        { header: 'Items', key: 'items', width: 8 },
        { header: 'Amount', key: 'amount', width: 15 },
        { header: 'Status', key: 'status', width: 12 }
    ];

    // Add company name and report title
    const titleRow = worksheet.addRow(['ANAMIT']);
    titleRow.font = { size: 16, bold: true };
    worksheet.mergeCells('A1:F1');

    // Add report details
    worksheet.addRow([]);
    const reportTypeRow = worksheet.addRow([`Sales Report - ${capitalizeFirstLetter(data.type)}`]);
    reportTypeRow.font = { size: 12, bold: true };
    worksheet.mergeCells('A3:F3');

    const dateRangeRow = worksheet.addRow([
        `Period: ${moment(data.startDate).format('DD/MM/YYYY')} to ${moment(data.endDate).format('DD/MM/YYYY')}`
    ]);
    worksheet.mergeCells('A4:F4');

    // Add summary section
    worksheet.addRow([]);
    const summaryRow = worksheet.addRow(['Summary']);
    summaryRow.font = { bold: true };

    // Add summary data
    const summaryData = [
        ['Total Orders:', data.totalOrders],
        ['Products Sold:', data.totalProductsSold],
        ['Total Revenue:', data.totalRevenue],
        ['Average Order Value:', data.averageOrderValue]
    ];

    summaryData.forEach(([label, value]) => {
        const row = worksheet.addRow([label, value]);
        if (label.includes('Revenue') || label.includes('Value')) {
            row.getCell(2).numFmt = '₹#,##0.00';
        }
    });

    // Add space before orders table
    worksheet.addRow([]);
    worksheet.addRow([]);

    // Add orders table header
    const headerRow = worksheet.addRow([
        'Order ID', 'Date', 'Customer', 'Items', 'Amount', 'Status'
    ]);
    headerRow.font = { bold: true };
    headerRow.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'F4F4F4' }
    };

    // Add order data
    data.orders.forEach((order, index) => {
        const row = worksheet.addRow([
            order.orderNumber,
            moment(order.createdAt).format('DD/MM/YYYY'),
            order.shippingAddress.fullName,
            order.items.length,
            order.finalAmount,
            capitalizeFirstLetter(order.orderStatus)
        ]);

        // Add zebra striping
        if (index % 2 === 0) {
            row.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FAFAFA' }
            };
        }

        // Format amount column
        row.getCell(5).numFmt = '₹#,##0.00';
    });

    // Add borders to the table
    const tableRange = `A${headerRow.number}:F${worksheet.rowCount}`;
    worksheet.eachRow({ includeEmpty: false }, row => {
        row.eachCell({ includeEmpty: false }, cell => {
            cell.border = {
                top: { style: 'thin' },
                left: { style: 'thin' },
                bottom: { style: 'thin' },
                right: { style: 'thin' }
            };
        });
    });

    // Add footer
    worksheet.addRow([]);
    const footerRow = worksheet.addRow([
        `Generated on: ${moment().format('DD/MM/YYYY, hh:mm A')}`
    ]);
    worksheet.mergeCells(`A${footerRow.number}:F${footerRow.number}`);
    footerRow.font = { italic: true, size: 8 };

    // Center align specific columns
    worksheet.getColumn(4).alignment = { horizontal: 'center' };
    worksheet.getColumn(5).alignment = { horizontal: 'right' };

    // Set print options
    worksheet.headerFooter.oddHeader = '&18ANAMIT';
    worksheet.headerFooter.oddFooter = '&IPage &P of &N';

    // Set response headers
    res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader(
        'Content-Disposition',
        `attachment; filename=ANAMIT_Sales_Report_${moment().format('DDMMYYYY')}.xlsx`
    );

    await workbook.xlsx.write(res);
    res.end();
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
getChartData
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