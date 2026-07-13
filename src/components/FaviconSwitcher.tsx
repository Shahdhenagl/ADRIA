import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

// يبدّل أيقونة المتصفح (favicon) وعنوان التبويب حسب اللوحة المفتوحة:
// - لوحة التحكم (/admin) → لوجو الخلفية السوداء «ADRIA admin».
// - الكاشير (أي مسار آخر) → لوجو الخلفية البيضاء «ADRIA CASHIER».
export default function FaviconSwitcher() {
  const location = useLocation();

  useEffect(() => {
    const isAdmin = location.pathname.startsWith('/admin');
    const href = isAdmin ? '/favicon-admin.svg' : '/favicon-cashier.svg';

    let link = document.getElementById('app-favicon') as HTMLLinkElement | null;
    if (!link) {
      link = document.createElement('link');
      link.id = 'app-favicon';
      link.rel = 'icon';
      link.type = 'image/svg+xml';
      document.head.appendChild(link);
    }
    if (link.getAttribute('href') !== href) link.setAttribute('href', href);

    document.title = isAdmin ? 'ADRIA — لوحة التحكم' : 'ADRIA — الكاشير';
  }, [location.pathname]);

  return null;
}
