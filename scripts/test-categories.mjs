import assert from "node:assert/strict";
import {categoryPayload, groupByCategory, UNCATEGORIZED_ID, UNCATEGORIZED_NAME, visibleCategories} from "../categories.js";

const categories = [
  {id:"oil",name:"Aceite de Oliva",active:true,deleted:false,sortOrder:2},
  {id:"nuts",name:"Almendras",active:true,deleted:false,sortOrder:1},
  {id:"old",name:"Categoría eliminada",active:true,deleted:true,sortOrder:3},
  {id:"off",name:"Inactiva",active:false,deleted:false,sortOrder:4}
];
const products = [
  {id:"p1",name:"Blend",categoryId:"oil",categoryName:"Aceite de Oliva"},
  {id:"p2",name:"Nonpareil",categoryId:"nuts",categoryName:"Almendras"},
  {id:"p3",name:"Viejo sin categoría"},
  {id:"p4",name:"Producto de categoría borrada",categoryId:"old",categoryName:"Categoría eliminada"},
  {id:"p5",name:"Producto de categoría inactiva",categoryId:"off",categoryName:"Inactiva"}
];

assert.deepEqual(visibleCategories(categories).map(item=>item.id),["nuts","oil"],"Sólo deben quedar categorías activas no eliminadas y ordenadas");
assert.deepEqual(categoryPayload("oil",categories),{categoryId:"oil",categoryName:"Aceite de Oliva"},"Debe crear payload de categoría válida");
assert.deepEqual(categoryPayload("old",categories),{categoryId:"",categoryName:""},"Una categoría eliminada no debe asignarse como válida");

const groups = groupByCategory(products,categories,{includeEmpty:false});
assert.deepEqual(groups.map(group=>group.name),["Almendras","Aceite de Oliva",UNCATEGORIZED_NAME],"Debe agrupar por categoría y mandar lo viejo a Sin categoría");
assert.equal(groups.find(group=>group.id===UNCATEGORIZED_ID).items.length,3,"Sin categoría debe contener productos viejos, eliminados o inactivos");

console.log("Categorías: 5 escenarios OK");
