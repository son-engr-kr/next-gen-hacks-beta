# 3D Model Generation Prompts

Use these with `generate.py --type food` or `--type building`.

**Style guide**: low-poly, bright saturated colors, flat shading, plastic toy feel.
Think mobile game icons — clean silhouette, no background clutter.

---

## Food Icons  (`--type food`)

Floating icons above each building. **Food only** — no plates, no tables, no utensils unless integral (e.g. bowl for ramen).

| category | prompt |
|----------|--------|
| burger | low poly cartoon hamburger, sesame bun, lettuce and tomato layers, bright colors, single object centered, 3D icon, white background |
| pizza | low poly cartoon pepperoni pizza slice, red pepperoni circles on melted cheese, triangular slice, bright colors, 3D icon, white background |
| sushi | low poly cartoon sushi nigiri pair, one salmon one tuna, simple rice block, bright colors, 3D icon, white background |
| ramen | low poly cartoon ramen bowl, noodles inside bowl, soft boiled egg, narutomaki, neat and tidy, bright colors, 3D icon, white background |
| cafe | low poly cartoon coffee cup, latte art heart on top, small rising steam, bright colors, 3D icon, white background |
| mexican | low poly cartoon taco, corn tortilla shell, meat and lettuce filling, bright colors, single taco only, 3D icon, white background |
| italian | low poly cartoon spaghetti and meatball, pasta twirled on fork, bright red sauce, 3D icon, white background |
| chinese | low poly cartoon dumpling trio, pleated wrapper, stacked together, bright colors, 3D icon, white background |
| thai | low poly cartoon green curry bowl, coconut soup with basil leaf on top, bright colors, no table, 3D icon, white background |
| steakhouse | low poly cartoon T-bone steak, grill marks, juicy thick cut, bright colors, no plate, 3D icon, white background |
| seafood | low poly cartoon red lobster, claws raised, bright red shell, simple shape, no plate, 3D icon, white background |
| bakery | low poly cartoon cupcake, tall swirl frosting, rainbow sprinkles, pastel colors, 3D icon, white background |

---

## Building Models  (`--type building`)

### Generic tiers (shared across all categories)

| category | prompt |
|----------|--------|
| building_regular | low poly tiny shop building, single storey, small awning, warm colors, cartoon miniature, 3D game asset, white background |
| building_mid | low poly cozy two-storey restaurant, balcony, glowing warm windows, neon open sign, cartoon miniature, 3D game asset, white background |
| building_major | low poly grand three-storey restaurant, rooftop terrace with string lights, large glass windows, golden awning, luxury feel, cartoon miniature, 3D game asset, white background |

### Landmark buildings (one per category — shaped like their food)

Each landmark is a building whose architecture is shaped like or strongly evokes its food category.
**Same low-poly cartoon style** — bright colors, flat shading, toy-like proportions.

| category | prompt |
|----------|--------|
| landmark_burger | low poly building shaped like a giant hamburger, sesame seed bun roof, lettuce and tomato middle floor, cartoon, bright colors, 3D game asset, white background |
| landmark_pizza | low poly building shaped like a giant pizza slice, pepperoni windows, melted cheese dripping from edges, cartoon, bright colors, 3D game asset, white background |
| landmark_sushi | low poly building shaped like a giant maki roll, nori-wrapped walls, rice visible on top, cartoon, bright colors, 3D game asset, white background |
| landmark_ramen | low poly building shaped like a giant ramen bowl, chopstick pillars, egg and narutomaki decorations, steam chimney, cartoon, bright colors, 3D game asset, white background |
| landmark_cafe | low poly building shaped like a giant coffee cup on saucer, latte art on roof, steam chimney, cartoon, bright colors, 3D game asset, white background |
| landmark_mexican | low poly building shaped like a giant taco, colorful shell walls, cactus at entrance, cartoon, bright colors, 3D game asset, white background |
| landmark_italian | low poly building shaped like a leaning tower of pasta, spaghetti columns, meatball dome roof, cartoon, bright colors, 3D game asset, white background |
| landmark_chinese | low poly building shaped like a giant dumpling, pleated roof, red and gold colors, small pagoda spire on top, cartoon, 3D game asset, white background |
| landmark_thai | low poly building shaped like a giant curry bowl, golden spire lid, green and yellow walls, cartoon, bright colors, 3D game asset, white background |
| landmark_steakhouse | low poly building shaped like a giant steak, grill-mark stripe walls, flame chimney on top, rustic wood door, cartoon, bright colors, 3D game asset, white background |
| landmark_seafood | low poly building shaped like a giant lobster, red shell roof, claw arches as entrance, cartoon, bright colors, 3D game asset, white background |
| landmark_bakery | low poly building shaped like a giant cupcake, frosting swirl roof, sprinkle decorations, pastel pink walls, cartoon, 3D game asset, white background |

---

## Tips for TRELLIS

- "low poly" + "cartoon" + "bright colors" pushes toward clean iconic look
- "white background" gives cleaner texture bake
- "3D icon" or "3D game asset" helps with topology
- "single object centered" prevents extra geometry (tables, plates)
- Avoid: "realistic", "detailed", "photorealistic", "on a plate", "on a table"
