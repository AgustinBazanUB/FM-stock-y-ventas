export const UNCATEGORIZED_ID = "__uncategorized";
export const UNCATEGORIZED_NAME = "Sin categoría";

export const visibleCategories = categories => (Array.isArray(categories)?categories:[])
  .filter(category => category?.deleted !== true && category?.active !== false)
  .sort((a,b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0) || String(a.name || "").localeCompare(String(b.name || "")));

export function categoryForItem(item = {}, categories = []) {
  const found = visibleCategories(categories).find(category => category.id === item.categoryId);
  return found ? {id:found.id,name:found.name,category:found,uncategorized:false} : {id:UNCATEGORIZED_ID,name:UNCATEGORIZED_NAME,category:null,uncategorized:true};
}

export function categoryNameForItem(item = {}, categories = []) {
  return categoryForItem(item,categories).name;
}

export function groupByCategory(items = [], categories = [], {includeEmpty = false, getCategoryId = item => item.categoryId, getCategoryName = item => item.categoryName} = {}) {
  const activeCategories = visibleCategories(categories);
  const groups = activeCategories.map(category => ({id:category.id,name:category.name,category,items:[]}));
  const uncategorized = {id:UNCATEGORIZED_ID,name:UNCATEGORIZED_NAME,category:null,items:[]};
  const byId = new Map(groups.map(group => [group.id,group]));
  (Array.isArray(items)?items:[]).forEach(item => {
    const categoryId = getCategoryId(item);
    const group = categoryId ? byId.get(categoryId) : null;
    if (group) group.items.push({...item,categoryName:group.name});
    else uncategorized.items.push({...item,categoryId:"",categoryName:getCategoryName(item)||UNCATEGORIZED_NAME});
  });
  const result = includeEmpty ? groups : groups.filter(group => group.items.length);
  if (uncategorized.items.length || includeEmpty) result.push(uncategorized);
  result.forEach(group => group.items.sort((a,b) => String(a.name || a.productName || "").localeCompare(String(b.name || b.productName || ""))));
  return result;
}

export function categoryPayload(categoryId, categories = []) {
  const category = visibleCategories(categories).find(item => item.id === categoryId);
  return category ? {categoryId:category.id,categoryName:category.name} : {categoryId:"",categoryName:""};
}
