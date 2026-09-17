import React from 'react';
import { Package } from 'lucide-react';

type Props = React.ImgHTMLAttributes<HTMLImageElement> & { fallbackClassName?: string };
export const ProductImage: React.FC<Props> = ({ src, alt = '', className = '', fallbackClassName = '', ...props }) => {
  const [failed, setFailed] = React.useState(false);
  React.useEffect(() => setFailed(false), [src]);
  if (!src || failed) return <span className={`flex items-center justify-center bg-slate-100 text-slate-400 ${fallbackClassName}`} role="img" aria-label={alt || 'Product image unavailable'}><Package className="w-10 h-10" /></span>;
  return <img src={src} alt={alt} loading="lazy" decoding="async" onError={() => setFailed(true)} className={className} {...props} />;
};