import React from 'react';
import ProductCard from './ProductCard';

export default function ProductGrid({ products }) {
  if (!products || !products.length) return null;

  return (
    <div className="product-grid">
      {products.map((product) => (
        <ProductCard key={product.id} product={product} />
      ))}
    </div>
  );
}
