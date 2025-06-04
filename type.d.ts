export interface Festival {
  id: string;
  title: string;
  thumbnail: string;
  dates: string //FestivalDate[]; 로 바꿔야함
  metropolis: string;
  locate: string;
  place: string;
  tag: string[];
  isFree: boolean;
}

export interface FestivalDate {
  startDate: Date;
  endDate?: Date; 
  displayDate?: string;  //  '상반/중반/하반'이 있을경우에 사용
}