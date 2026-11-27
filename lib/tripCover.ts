export type TripCover = {
  coverImageUrl: string;
  coverImageSource: 'uploaded' | 'destination' | 'tripType' | 'default';
  coverImageAttribution?: string;
};

function bundledCover(name: string, source: TripCover['coverImageSource']): TripCover {
  return { coverImageUrl: `/images/trip-covers/${name}.webp`, coverImageSource: source };
}

const destinationImages = [
  { image: 'bagan', aliases: ['bagan', 'pagan', 'バガン', 'ပုဂံ'] },
  { image: 'osaka', aliases: ['osaka', '大阪'] },
  { image: 'tokyo', aliases: ['tokyo', '東京'] },
  { image: 'kyoto', aliases: ['kyoto', '京都'] },
  { image: 'paris', aliases: ['paris', 'パリ'] },
];

const tripTypeImages = new Set(['camping', 'hiking', 'beach', 'city']);
export const defaultTripCover = bundledCover('default', 'default');
export const coverImageTypes = ['image/jpeg', 'image/png', 'image/webp'];
export const coverImageSizeLimit = 5 * 1024 * 1024;

function normalize(value: string) {
  return typeof value === 'string' ? value.normalize('NFKD').toLowerCase().replace(/\p{M}/gu, '').trim() : '';
}

export function findDestinationCover(destination: string): TripCover | undefined {
  const location = normalize(destination);
  // Match words in city/region/country labels without treating names such as Parisian as Paris.
  const words = location.split(/[^\p{L}\p{N}]+/u);
  const match = destinationImages.find(({ aliases }) => aliases.some(alias =>
    /^[a-z]+$/.test(alias) ? words.includes(alias) : location.includes(normalize(alias)),
  ));
  return match && bundledCover(match.image, 'destination');
}

export function getDestinationCoverImage(destination: string, tripType: string): TripCover {
  const type = normalize(tripType);
  return findDestinationCover(destination) ?? (tripTypeImages.has(type) ? bundledCover(type, 'tripType') : defaultTripCover);
}

export function tripCoverCandidates(trip: Partial<TripCover> & { location: string; type: string }): TripCover[] {
  if (trip.coverImageSource === 'default') return [defaultTripCover];
  const automatic = getDestinationCoverImage(trip.location, trip.type);
  const fallback = getDestinationCoverImage('', trip.type);
  const covers = [automatic, fallback, defaultTripCover];
  if (trip.coverImageSource === 'uploaded' && typeof trip.coverImageUrl === 'string' && trip.coverImageUrl.startsWith('https://')) {
    covers.unshift({
      coverImageSource: 'uploaded',
      coverImageUrl: trip.coverImageUrl,
      ...(typeof trip.coverImageAttribution === 'string' ? { coverImageAttribution: trip.coverImageAttribution } : {}),
    });
  }
  return [...new Map(covers.map(cover => [cover.coverImageUrl, cover])).values()];
}
