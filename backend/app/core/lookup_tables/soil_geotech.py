"""
Static reference tables for soil physical/geotechnical properties, since no
dataset directly measures these per-village. Values are standard literature
defaults (soil-physics properties from Rawls et al. 1982 / Saxton & Rawls;
geotechnical properties are typical ranges for weathered hillslope material in
Himalayan/Western Ghats settings). Disclose these as literature-based
approximations, not measured data, when presenting the system.
"""

# Porosity and field capacity (volumetric fraction, 0-1) by USDA soil texture class.
# Used to normalize a raw soil-moisture reading into a 0-1 saturation ratio.
SOIL_HYDRAULIC_PROPERTIES = {
    "sand": {"porosity": 0.437, "field_capacity": 0.09},
    "loamy_sand": {"porosity": 0.437, "field_capacity": 0.125},
    "sandy_loam": {"porosity": 0.453, "field_capacity": 0.207},
    "loam": {"porosity": 0.463, "field_capacity": 0.270},
    "silt_loam": {"porosity": 0.501, "field_capacity": 0.330},
    "sandy_clay_loam": {"porosity": 0.398, "field_capacity": 0.255},
    "clay_loam": {"porosity": 0.464, "field_capacity": 0.318},
    "silty_clay_loam": {"porosity": 0.471, "field_capacity": 0.366},
    "clay": {"porosity": 0.475, "field_capacity": 0.396},
}

# Geotechnical parameters for the infinite-slope Factor of Safety calculation,
# by broad terrain/regolith class. c = cohesion (kPa), phi = friction angle
# (degrees), gamma = unit weight (kN/m^3), z = typical shallow-landslide
# regolith depth (m) used as a default when no better estimate exists.
TERRAIN_GEOTECH_PROPERTIES = {
    "himalayan_colluvium": {"c_kpa": 10.0, "phi_deg": 28.0, "gamma_kn_m3": 19.0, "z_m": 1.5},
    "western_ghats_laterite": {"c_kpa": 14.0, "phi_deg": 31.0, "gamma_kn_m3": 19.5, "z_m": 1.8},
    "weathered_rock_debris": {"c_kpa": 12.0, "phi_deg": 30.0, "gamma_kn_m3": 19.5, "z_m": 1.5},
    "generic_hillslope_default": {"c_kpa": 10.0, "phi_deg": 28.0, "gamma_kn_m3": 19.0, "z_m": 1.5},
}


def get_soil_hydraulic_properties(soil_texture: str) -> dict:
    key = soil_texture.strip().lower().replace(" ", "_")
    return SOIL_HYDRAULIC_PROPERTIES.get(key, SOIL_HYDRAULIC_PROPERTIES["loam"])


def get_terrain_geotech_properties(terrain_class: str) -> dict:
    key = terrain_class.strip().lower().replace(" ", "_")
    return TERRAIN_GEOTECH_PROPERTIES.get(key, TERRAIN_GEOTECH_PROPERTIES["generic_hillslope_default"])
