export const KENYA_COUNTIES = [
  ['001', 'Mombasa'], ['002', 'Kwale'], ['003', 'Kilifi'], ['004', 'Tana River'], ['005', 'Lamu'],
  ['006', 'Taita Taveta'], ['007', 'Garissa'], ['008', 'Wajir'], ['009', 'Mandera'], ['010', 'Marsabit'],
  ['011', 'Isiolo'], ['012', 'Meru'], ['013', 'Tharaka-Nithi'], ['014', 'Embu'], ['015', 'Kitui'],
  ['016', 'Machakos'], ['017', 'Makueni'], ['018', 'Nyandarua'], ['019', 'Nyeri'], ['020', 'Kirinyaga'],
  ['021', "Murang'a"], ['022', 'Kiambu'], ['023', 'Turkana'], ['024', 'West Pokot'], ['025', 'Samburu'],
  ['026', 'Trans Nzoia'], ['027', 'Uasin Gishu'], ['028', 'Elgeyo-Marakwet'], ['029', 'Nandi'], ['030', 'Baringo'],
  ['031', 'Laikipia'], ['032', 'Nakuru'], ['033', 'Narok'], ['034', 'Kajiado'], ['035', 'Kericho'],
  ['036', 'Bomet'], ['037', 'Kakamega'], ['038', 'Vihiga'], ['039', 'Bungoma'], ['040', 'Busia'],
  ['041', 'Siaya'], ['042', 'Kisumu'], ['043', 'Homa Bay'], ['044', 'Migori'], ['045', 'Kisii'],
  ['046', 'Nyamira'], ['047', 'Nairobi City'],
];

export const KENYA_SCHOOL_TYPES = [
  ['pre_primary', 'Pre-primary'],
  ['primary', 'Primary'],
  ['junior_school', 'Junior School'],
  ['senior_school', 'Senior School'],
  ['integrated', 'Integrated school'],
  ['special_needs', 'Special-needs school'],
  ['international', 'International school'],
  ['mixed', 'Mixed levels'],
  ['other', 'Other'],
];

export const KENYA_GRADE_LEVELS = [
  ['PP1', 'Pre-Primary 1', 'pre_primary', 1],
  ['PP2', 'Pre-Primary 2', 'pre_primary', 2],
  ...Array.from({ length: 12 }, (_, i) => {
    const grade = i + 1;
    const stage = grade <= 6 ? 'primary' : grade <= 9 ? 'junior_school' : 'senior_school';
    return [`G${grade}`, `Grade ${grade}`, stage, grade + 2];
  }),
];

export const KENYA_CBE_PATHWAYS = [
  ['stem', 'STEM', 'Science, Technology, Engineering and Mathematics', 1],
  ['social_sciences', 'Social Sciences', 'Social Sciences', 2],
  ['arts_sports_science', 'Arts and Sports Science', 'Arts and Sports Science', 3],
];

export const KENYA_ASSESSMENT_LEVELS = [
  ['BE', 'Below expectation', 1],
  ['AE', 'Approaching expectation', 2],
  ['ME', 'Meeting expectation', 3],
  ['EE', 'Exceeding expectation', 4],
];

export const KENYA_TERM_TEMPLATES = [
  ['term_1', 'Term 1', 1],
  ['term_2', 'Term 2', 2],
  ['term_3', 'Term 3', 3],
];
