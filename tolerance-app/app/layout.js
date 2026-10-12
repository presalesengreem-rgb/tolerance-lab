import './globals.css';

export const metadata = {
  title: 'حاسبة التولرنس',
  description: 'مقارنة HEX الشركة مع قراءة السبكترو بمعيار CIEDE2000',
};

export default function RootLayout({ children }) {
  return (
    <html lang="ar" dir="rtl">
      <body style={{ margin: 0 }}>{children}</body>
    </html>
  );
}
