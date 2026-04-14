# Google Places API (New) — 사용 가능한 필드 레퍼런스

## 현재 사용 중인 필드

| 필드 | 설명 | 용도 |
|------|------|------|
| `places.id` | Place ID | 고유 식별자 |
| `places.displayName` | 가게 이름 | 패널 표시 |
| `places.types` | 장소 타입 목록 | Category 매핑 |
| `places.location` | 위도/경도 | 지도 핀 위치 |
| `places.rating` | 별점 (1.0~5.0) | 건물 색상/높이 |
| `places.userRatingCount` | 리뷰 수 | 건물 높이 |
| `places.editorialSummary` | 구글 한줄 소개 | 패널 description |
| `places.reviews` | 최대 5개 리뷰 (텍스트/별점/작성자/날짜) | topReview |

---

## 미사용 필드 — 향후 활용 예정

### 편의시설 / 접근성
| 필드 | 타입 | 시각화 계획 |
|------|------|-------------|
| `places.accessibilityOptions.wheelchairAccessibleEntrance` | bool | 건물 위 위성 궤도 아이콘 ♿ |
| `places.accessibilityOptions.wheelchairAccessibleParking` | bool | 동일 |
| `places.accessibilityOptions.wheelchairAccessibleRestroom` | bool | 동일 |
| `places.accessibilityOptions.wheelchairAccessibleSeating` | bool | 동일 |
| `places.parkingOptions.freeParkingLot` | bool | 건물 옆 P 표시 시각화 |
| `places.parkingOptions.paidParkingLot` | bool | 동일 |
| `places.parkingOptions.freeStreetParking` | bool | 동일 |
| `places.parkingOptions.valetParking` | bool | 동일 |
| `places.parkingOptions.freeGarageParking` | bool | 동일 |
| `places.parkingOptions.paidGarageParking` | bool | 동일 |

### 서비스 옵션
| 필드 | 타입 | 활용 아이디어 |
|------|------|--------------|
| `places.delivery` | bool | 배달 가능 뱃지 |
| `places.takeout` | bool | 포장 가능 뱃지 |
| `places.dineIn` | bool | 식사 가능 뱃지 |
| `places.reservable` | bool | 예약 가능 표시 |
| `places.liveMusic` | bool | 건물 위 음표 아이콘 |
| `places.outdoorSeating` | bool | 야외 좌석 표시 |
| `places.goodForGroups` | bool | 단체 가능 표시 |
| `places.allowsDogs` | bool | 반려동물 가능 뱃지 |

### 음식/음료 카테고리
| 필드 | 타입 |
|------|------|
| `places.servesBreakfast` | bool |
| `places.servesLunch` | bool |
| `places.servesDinner` | bool |
| `places.servesBeer` | bool |
| `places.servesWine` | bool |
| `places.servesCocktails` | bool |
| `places.servesCoffee` | bool |
| `places.servesDessert` | bool |

### 영업 정보
| 필드 | 타입 | 활용 아이디어 |
|------|------|--------------|
| `places.currentOpeningHours.openNow` | bool | 건물 발광 색상 (열림=밝음, 닫힘=어두움) |
| `places.currentOpeningHours.periods` | array | 영업시간 상세 |
| `places.regularOpeningHours` | object | 요일별 시간표 |
| `places.businessStatus` | enum | OPERATIONAL / CLOSED_TEMPORARILY / CLOSED_PERMANENTLY |

### 가격/결제
| 필드 | 타입 | 활용 아이디어 |
|------|------|--------------|
| `places.priceLevel` | enum | FREE / INEXPENSIVE / MODERATE / EXPENSIVE / VERY_EXPENSIVE → 건물 재질 반영 |
| `places.paymentOptions.acceptsCreditCards` | bool | |
| `places.paymentOptions.acceptsCashOnly` | bool | |

### 연락처/위치
| 필드 | 타입 |
|------|------|
| `places.formattedAddress` | string |
| `places.shortFormattedAddress` | string |
| `places.internationalPhoneNumber` | string |
| `places.websiteUri` | string |
| `places.googleMapsUri` | string |

### 사진
| 필드 | 타입 | 활용 아이디어 |
|------|------|--------------|
| `places.photos` | array | 사진 레퍼런스 → `GET /v1/{name}/media?maxWidthPx=400&key=KEY` 로 이미지 URL 획득 |

---

## 3D 시각화 계획

### 현재 (랜드마크 위 별 궤도) → 교체 예정
랜드마크 건물 위를 별(`★`)이 돌아다니는 것 → **장소 특성을 반영한 의미있는 아이콘**으로 교체

| 조건 | 궤도 아이콘 | 의미 |
|------|------------|------|
| `wheelchairAccessible*` 중 하나라도 true | ♿ (위성 궤도) | 접근성 우수 |
| `liveMusic === true` | 🎵 | 라이브 음악 |
| `servesCocktails === true` | 🍸 | 칵테일 바 |
| `allowsDogs === true` | 🐕 | 반려동물 환영 |
| `isTrending === true` | 🔥 | 트렌딩 (현재 파이어웍스 대체) |
| `rating >= 4.5` | ⭐ | 최고 평점 |

### 주차 시각화
건물 바닥 주변에 주차 가능 여부를 표시하는 별도 3D 오브젝트:
- `freeParkingLot / freeStreetParking` → 초록 **P** 표지판 3D 오브젝트
- `paidParkingLot / paidGarageParking` → 파란 **P$** 표지판
- `valetParking` → 금색 **V** 표지판
- 주차 불가 → 표지판 없음

### 접근성 위성 표시
`wheelchairAccessible*` 하나라도 true인 건물:
- 건물 꼭대기에서 일정 반경으로 **♿ 아이콘이 위성처럼 천천히 공전**
- 궤도 링도 반투명하게 표시 (토성 링 스타일)

### 영업 상태 시각화
- `openNow === true` → 건물 emissive 밝기 정상
- `openNow === false` → 건물 emissive 50% 감소 (어두운 느낌)
- `CLOSED_PERMANENTLY` → 건물 회색 처리

---

## API 필드 추가 방법

`motzip-server/main.py` → `field_mask` 문자열에 필드 추가:

```python
field_mask = ",".join([
    "places.id",
    "places.displayName",
    "places.types",
    "places.location",
    "places.rating",
    "places.userRatingCount",
    "places.editorialSummary",
    "places.reviews",
    # 추가할 필드:
    "places.accessibilityOptions",
    "places.parkingOptions",
    "places.currentOpeningHours",
    "places.priceLevel",
    "places.liveMusic",
    "places.allowsDogs",
    "places.servesCocktails",
    "places.photos",
])
```

그리고 `PlaceRestaurant` 모델에 필드 추가 후 파싱 로직 작성.

---

## 비용 참고 (월 $200 무료 크레딧 기준)

| SKU | 가격 / 1000 req |
|-----|----------------|
| Nearby Search Basic | $32 |
| Nearby Search Advanced (reviews, photos 포함) | $40 |
| Place Details Basic | $17 |
| Place Details Advanced | $20 |

해커톤 데모 수준 → 무료 크레딧 내 충분히 커버 가능.
