// 알림 시점 (분 단위). 설계 문서 3.3 참고.
export const timing = {
  eveningHour: 19, // 전날 저녁 7시
  prepBeforeDepartureMin: 60, // 출발 60분 전 준비 알림
  askBeforeDepartureMin: 30, // 출발 30분 전 "뭐 타고 가실래요?"
  escalateAfterAskMin: 10, // 무응답 10분 → 자녀에게
  arriveEarlyMin: 10, // 약속 10분 전 도착 목표
  taxiLeadMin: 10, // 출발 10분 전에 택시 호출 (배차·도착 시간)
  duplicateWindowMin: 30, // 30분 이내 같은 장소 = 같은 일정
  overlapWindowMin: 120, // 2시간 이내 = 겹칠 수 있는 일정
};
