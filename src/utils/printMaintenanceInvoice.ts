import type { Order } from '../store/useStore';
import { escapeHtml } from './escapeHtml';

export const printMaintenanceInvoice = (
  order: Order & { report?: string },
  carInfo: { carNumber: string, carDetails: string, customerName: string, customerPhone: string },
  storeSettings: any
) => {
  const invoiceWindow = window.open('', '_blank');
  if (!invoiceWindow) return;

  // Generate QR data
  const qrData = encodeURIComponent(
    JSON.stringify({
      inv: 'MAINT_E_INV',
      car: carInfo.carNumber,
      customer: carInfo.customerName,
      total: order.total,
      date: order.date
    })
  );

  const html = `
    <!DOCTYPE html>
    <html dir="rtl" lang="ar">
    <head>
      <meta charset="UTF-8">
      <title>فاتورة صيانة سيارة - ${escapeHtml(carInfo.carNumber)}</title>
      <style>
        @import url('https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800;900&display=swap');
        
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }
        
        body {
          font-family: 'Cairo', sans-serif;
          background-color: #ffffff;
          color: #1e293b;
          padding: 40px;
          max-width: 850px;
          margin: 0 auto;
          line-height: 1.6;
        }

        /* Header Layout */
        .header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          border-bottom: 3px double #e2e8f0;
          padding-bottom: 24px;
          margin-bottom: 24px;
        }
        
        .store-info {
          text-align: right;
        }
        
        .store-info h1 {
          font-size: 26px;
          font-weight: 900;
          color: #0f172a;
          margin-bottom: 6px;
        }
        
        .store-info p {
          font-size: 13px;
          color: #64748b;
          margin-bottom: 4px;
        }
        
        .invoice-title {
          text-align: left;
        }
        
        .invoice-title h2 {
          font-size: 22px;
          font-weight: 900;
          color: #10b981;
          background: #ecfdf5;
          padding: 8px 20px;
          border-radius: 12px;
          display: inline-block;
          margin-bottom: 10px;
        }
        
        .invoice-title p {
          font-size: 13px;
          color: #64748b;
          margin-bottom: 4px;
        }

        /* Customer & Vehicle Info Grid */
        .info-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 20px;
          margin-bottom: 24px;
        }
        
        .info-card {
          background: #f8fafc;
          padding: 16px 20px;
          border-radius: 16px;
          border: 1px solid #e2e8f0;
        }
        
        .info-card label {
          display: block;
          font-size: 11px;
          font-weight: 800;
          color: #94a3b8;
          margin-bottom: 6px;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }
        
        .info-card p {
          font-size: 16px;
          font-weight: 700;
          color: #0f172a;
        }
        
        .info-card .sub {
          font-size: 13px;
          color: #64748b;
          margin-top: 3px;
        }

        /* Visit Report Box */
        .report-box {
          background: #eff6ff;
          padding: 16px 20px;
          border-radius: 16px;
          border: 1px solid #bfdbfe;
          margin-bottom: 24px;
          font-size: 14px;
          color: #1e40af;
        }
        
        .report-box strong {
          font-weight: 800;
          color: #1d4ed8;
          display: block;
          margin-bottom: 4px;
          font-size: 12px;
        }

        /* Items Table */
        table {
          width: 100%;
          border-collapse: collapse;
          margin-bottom: 24px;
        }
        
        thead th {
          background: #f1f5f9;
          color: #475569;
          text-align: right;
          padding: 12px 16px;
          font-size: 13px;
          font-weight: 700;
          border-bottom: 2px solid #cbd5e1;
        }
        
        tbody td {
          padding: 14px 16px;
          border-bottom: 1px solid #e2e8f0;
          font-size: 14px;
          color: #334155;
        }
        
        tbody tr:hover {
          background: #fafafa;
        }
        
        /* Totals section */
        .totals-container {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          margin-top: 8px;
        }

        .payment-info {
          font-size: 13px;
          color: #64748b;
        }

        .payment-info p {
          margin-bottom: 4px;
        }

        .payment-info strong {
          color: #0f172a;
        }

        .totals-box {
          width: 320px;
          padding: 20px;
          background: #f0fdf4;
          border-radius: 16px;
          border: 2px solid #bbf7d0;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        
        .totals-box .label {
          font-size: 16px;
          font-weight: 800;
          color: #166534;
        }
        
        .totals-box .amount {
          font-size: 26px;
          font-weight: 900;
          color: #16a34a;
        }

        /* QR Code & Verification */
        .qr-section {
          text-align: center;
          margin-top: 35px;
          padding-top: 20px;
          border-top: 2px dashed #e2e8f0;
        }
        
        .qr-section img {
          width: 120px;
          height: 120px;
          margin: 0 auto 8px;
          display: block;
        }
        
        .qr-section p {
          font-size: 12px;
          color: #94a3b8;
          font-weight: bold;
        }
        
        .footer {
          text-align: center;
          margin-top: 24px;
          font-size: 13px;
          color: #94a3b8;
          border-top: 1px solid #f1f5f9;
          padding-top: 16px;
          font-weight: bold;
        }

        @media print {
          body {
            padding: 0;
          }
          @page {
            margin: 10mm;
            size: A4;
          }
        }
      </style>
    </head>
    <body>
      <div class="header">
        <div class="store-info">
          <h1>${escapeHtml(storeSettings?.name || 'مركز الخدمة')}</h1>
          <p>${escapeHtml(storeSettings?.address || '')}</p>
          <p>${escapeHtml(storeSettings?.phone || '')}</p>
        </div>
        <div class="invoice-title">
          <h2>فاتورة صيانة سيارة</h2>
          <p>رقم الفاتورة: #${(order.id || '').slice(0, 8)}</p>
          <p>التاريخ: ${new Date(order.date).toLocaleString('ar-SA')}</p>
        </div>
      </div>

      <div class="info-grid">
        <div class="info-card">
          <label>بيانات العميل</label>
          <p>${escapeHtml(carInfo.customerName)}</p>
          <div class="sub">${escapeHtml(carInfo.customerPhone)}</div>
        </div>
        <div class="info-card">
          <label>بيانات السيارة</label>
          <p>${escapeHtml(carInfo.carNumber)}</p>
          <div class="sub">${escapeHtml(carInfo.carDetails || '-')}</div>
        </div>
      </div>

      ${order.report ? `
        <div class="report-box">
          <strong>تقرير الفحص والزيارة</strong>
          ${escapeHtml(order.report)}
        </div>
      ` : ''}

      <table>
        <thead>
          <tr>
            <th style="width: 50px;">م</th>
            <th>البيان</th>
            <th style="width: 120px;">التاريخ</th>
            <th style="width: 80px; text-align: center;">الكمية</th>
            <th style="width: 100px; text-align: left;">سعر الوحدة</th>
            <th style="width: 120px; text-align: left;">الإجمالي</th>
          </tr>
        </thead>
        <tbody>
          ${(order.items || []).map((item: any, i: number) => {
            const qty = item.quantity || 1;
            const price = item.sale_price || 0;
            const itemTotal = qty * price;
            const itemDate = item.date || new Date(order.date).toLocaleDateString('ar-SA');
            return `
              <tr>
                <td>${i + 1}</td>
                <td style="font-weight: 700; color: #0f172a;">${escapeHtml(item.name)}</td>
                <td>${itemDate}</td>
                <td style="text-align: center;">${qty}</td>
                <td style="text-align: left;">${price.toFixed(2)} ج.م</td>
                <td style="font-weight: 700; text-align: left; color: #0f172a;">${itemTotal.toFixed(2)} ج.م</td>
              </tr>
            `;
          }).join('')}
          ${(!order.items || order.items.length === 0) ? `
            <tr>
              <td colspan="6" style="text-align: center; padding: 30px; color: #94a3b8; font-weight: bold;">لا توجد بنود مسجلة</td>
            </tr>
          ` : ''}
        </tbody>
      </table>

      <div class="totals-container">
        <div class="payment-info">
          <p>طريقة الدفع: <strong>${
            order.payment_method === 'cash' ? 'نقدي (كاش)' :
            order.payment_method === 'visa' ? 'فيزا' :
            order.payment_method === 'wallet' ? 'محفظة إلكترونية' :
            order.payment_method === 'instapay' ? 'انستا باي' : 'نقدي'
          }</strong></p>
          <p>الحالة: <strong style="color: #10b981;">مدفوعة بالكامل</strong></p>
        </div>
        <div class="totals-box">
          <span class="label">الإجمالي المطلوب</span>
          <span class="amount">${(order.total || order.paid_amount || 0).toFixed(2)} ج.م</span>
        </div>
      </div>

      <div class="qr-section">
        <img src="https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=${qrData}" alt="QR Code Verification" />
        <p>فاتورة إلكترونية معتمدة رقمياً</p>
      </div>

      <div class="footer">
        نشكركم لتعاملكم معنا ونتمنى لكم سلامة دائمًا على الطريق
      </div>

      <script>
        window.onload = () => {
          window.print();
          setTimeout(() => window.close(), 500);
        };
      </script>
    </body>
    </html>
  `;

  invoiceWindow.document.write(html);
  invoiceWindow.document.close();
};
