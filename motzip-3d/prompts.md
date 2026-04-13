# 3D Model Generation Prompts

Use these with `generate.py --type food` or `--type building`.

---

## Food Icons  (`--type food`)

Floating icons above each building.

| category | prompt |
|----------|--------|
| burger | cute miniature hamburger, isometric, stylized game asset, soft pastel colors |
| pizza | cute pizza slice with melted cheese, miniature, cartoon style, game asset |
| sushi | kawaii sushi platter with nigiri and maki rolls, miniature, stylized |
| ramen | cute steaming ramen bowl with chopsticks, miniature, cartoon game asset |
| cafe | cute coffee cup with latte art and steam, miniature, isometric game asset |
| mexican | cute taco with toppings, miniature, colorful cartoon style, game asset |
| italian | cute pasta bowl with spaghetti and meatball, miniature, cartoon style |
| chinese | cute dim sum bamboo steamer, miniature, isometric, game asset |
| thai | cute thai curry bowl with jasmine rice, miniature, stylized game asset |
| steakhouse | cute grilled steak on plate, miniature, cartoon style, game asset |
| seafood | cute lobster on plate, miniature, kawaii style, game asset |
| bakery | cute cupcake with swirl frosting, miniature, pastel cartoon, game asset |

---

## Building Models  (`--type building`)

### Generic tiers (shared across all categories)

| category | prompt |
|----------|--------|
| building_regular | tiny run-down diner building, weathered brick, cracked paint, rusty sign, single storey, isometric, stylized 3D game asset |
| building_mid | cozy neighborhood restaurant building, warm brick facade, glowing neon sign, two storeys, isometric, stylized 3D game asset |
| building_major | upscale modern restaurant, glass and steel facade, elegant canopy entrance, three storeys, isometric, stylized 3D game asset |

### Landmark buildings (one per category — shaped like their food)

Each landmark is a building whose architecture is shaped like or strongly evokes its food category.

| category | prompt |
|----------|--------|
| landmark_burger | restaurant building shaped like a giant hamburger, sesame seed bun roof, lettuce and tomato walls, golden arched entrance, whimsical architecture, isometric, stylized 3D game asset |
| landmark_pizza | pizzeria building with circular pizza-shaped roof, pepperoni window holes, melted cheese dripping eaves, Italian flag, isometric, stylized 3D game asset |
| landmark_sushi | sushi restaurant shaped like a giant maki roll wrapped in nori, bamboo garden entrance, Japanese paper lanterns, isometric, stylized 3D game asset |
| landmark_ramen | ramen shop building shaped like a giant ramen bowl, chopstick columns, steam rising from rooftop vents, noren curtain entrance, isometric, stylized 3D game asset |
| landmark_cafe | coffee shop building shaped like a giant coffee cup on a saucer base, steam chimney, latte art window, chalkboard sign, isometric, stylized 3D game asset |
| landmark_mexican | Mexican restaurant shaped like a giant colorful taco, vibrant tilework facade, sombrero roof dome, cactus sculptures flanking door, isometric, stylized 3D game asset |
| landmark_italian | Italian trattoria building shaped like a pasta bowl, Tuscan arched windows, vine-covered walls, chef statue at entrance, isometric, stylized 3D game asset |
| landmark_chinese | Chinese restaurant shaped like a dim sum bamboo steamer, golden pagoda roof, red lanterns, dragon relief sculptures, isometric, stylized 3D game asset |
| landmark_thai | Thai restaurant with golden temple spire roof, elephant sculptures flanking entrance, lotus pond courtyard, ornate gilded facade, isometric, stylized 3D game asset |
| landmark_steakhouse | steakhouse building shaped like a giant steak on a plate, rustic reclaimed wood and stone facade, cowboy hat clock tower, grill smoke chimneys, isometric, stylized 3D game asset |
| landmark_seafood | seafood restaurant shaped like a giant red lobster, curved claw arches as entrance, lighthouse tower, nautical rope and anchor details, isometric, stylized 3D game asset |
| landmark_bakery | bakery building shaped like a giant cupcake, frosting swirl rooftop, pastel pink walls, sprinkle window trim, macaroon-shaped skylights, isometric, stylized 3D game asset |

---

## Tips for TRELLIS

- "isometric" gives a consistent viewing angle
- "stylized 3D game asset" pushes toward clean topology
- "soft lighting, white background" for cleaner texture bake
- Upload a reference image for more consistent results
