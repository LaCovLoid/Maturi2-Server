export interface Festival {
  id: string;
  title: string;
  thumbnail: string;
  date: string;
  metropolis: string;
  locate: string;
  place: string;
  tag: string[];
  isFree: boolean;
}

export interface FestivalDate {
  startYear: number;
  startMonth: number;
  startDay: number;

  endYear?: number;
  endMonth?: number;
  endDay?: number;

  // 상반 중반 하반이 있는 경우에만
  displayDate?: string;
}