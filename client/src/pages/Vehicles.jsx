import { useEffect, useState } from 'react';
import { fetchCategory } from '../lib';
import Catalog from '../components/Catalog';

export default function Vehicles() {
  const [products, setProducts] = useState();
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState();

  useEffect(() => {
    async function loadProducts() {
      try {
        const products = await fetchCategory('vehicles');
        setProducts(products);
      } catch (err) {
        setError(err);
      } finally {
        setIsLoading(false);
      }
    }
    setIsLoading(true);
    loadProducts();
  }, []);

  if (isLoading) return <div>Loading...</div>;
  if (error) return <div>Error Loading Products: {error.message}</div>;
  return (
    <div className="card-deck">
      <div className="row row-cols-1 row-cols-md-3 row-cols-lg-4 g-4">
        {products?.map((product) => (
          <div key={product.productId} className="col">
            <Catalog product={product} />
          </div>
        ))}
      </div>
    </div>
  );
}
