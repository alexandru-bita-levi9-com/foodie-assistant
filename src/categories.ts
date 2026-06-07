import { parse } from 'yaml'
import { z } from 'zod'
import categoriesYaml from './data/wolt-categories.yaml?raw'
import type { WoltCategory } from './types'

const categorySchema = z.object({
  categories: z.array(
    z.object({
      title: z.string(),
      slug: z.string(),
      filterSlug: z.string().optional(),
      sectionSlug: z.string().optional(),
      image: z.string().optional(),
    }),
  ),
})

const parsedCategories = categorySchema.parse(parse(categoriesYaml))

export const WOLT_CATEGORIES: WoltCategory[] = parsedCategories.categories.map(
  (category) => ({
    title: category.title,
    slug: category.slug,
    filterSlug: category.filterSlug ?? category.slug,
    sectionSlug: category.sectionSlug ?? 'category',
    image: category.image,
  }),
)

export const WOLT_CATEGORIES_YAML = categoriesYaml

export const findCategoryBySlug = (slug: string) =>
  WOLT_CATEGORIES.find((category) => category.slug === slug || category.filterSlug === slug)