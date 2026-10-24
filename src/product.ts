// The product's identity. Everything that shows or stores the product's name reads it from
// product.json, so renaming the product is a one-file change. Changing appId after a public release
// orphans users' settings, because the user-data folder is derived from it.
import product from "../product.json" with { type: "json" };

export const PRODUCT = product as {
  name: string;
  slug: string;
  appId: string;
  fileExtension: string;
  description: string;
  logo: string;
};
