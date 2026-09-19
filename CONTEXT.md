# aws-infra

joynnovate 팀의 AWS 인프라를 Pulumi로 정의하는 저장소다.
여러 제품이 함께 사용하는 인프라와 buddybird 제품의 인프라를 다룬다.

## Language

### 제품과 서비스

**제품**:
팀이 운영하는 서비스의 묶음이다.
현재 제품은 buddybird 하나다.
_Avoid_: 앱, 프로젝트

**서비스**:
제품을 이루는 배포 단위이고 앱의 GitHub 저장소 하나에 대응한다.
buddybird의 서비스는 api, backoffice frontend, mbti web, landing이다.
_Avoid_: 앱, 컴포넌트

**api**:
buddybird의 백엔드 서비스다.
_Avoid_: backend, server

**backoffice frontend**:
운영자가 사용하는 관리 화면 서비스다.
_Avoid_: bo-fe, backoffice, admin

**mbti web**:
MBTI 검사를 제공하는 웹 서비스다.
_Avoid_: mbti

**landing**:
루트 도메인에서 제공하는 정적 페이지 서비스다.
한국어 문서에서는 랜딩으로 표기한다.
_Avoid_: site, landing-fe, 랜딩 페이지

### 프로세스와 판정

**consumer**:
api 서비스에 속하며 HTTP 요청을 받지 않고 큐의 메시지를 처리하는 프로세스다.
서비스로 세지 않는다.
_Avoid_: worker, 백그라운드 서버

**판정 worker**:
앵무새 소리 판정과 단어 모사 판정을 실행하는 프로세스다.
api 서비스에 속하지 않는다.
_Avoid_: consumer, 추론 서버, 판정 서버

**앵무새 소리 판정**:
세션에서 감지한 소리가 앵무새가 낸 소리인지 가리는 판정이다.
_Avoid_: 소리 분류

**단어 모사 판정**:
앵무새 소리가 학습 중인 단어를 따라 한 것인지와 그 정확도를 가리는 판정이다.
_Avoid_: 유사도 판정

### 환경과 소유

**환경**:
서비스가 실행되는 격리 단위다.
dev와 prod가 있다.
_Avoid_: stage, 단계

**프로젝트**:
Pulumi 프로젝트를 가리킨다.
제품이나 서비스를 프로젝트라고 부르지 않는다.
_Avoid_: 모듈, 레이어

**공용 인프라**:
여러 제품이 함께 사용하는 인프라다.
_Avoid_: 공통 인프라, 플랫폼

**환경 공유 리소스**:
한 제품에 속하지만 그 제품의 모든 환경이 함께 사용하는 리소스다.
_Avoid_: 공통 리소스, 공유 자원

### 역할

**CI 역할**:
이 저장소의 GitHub Actions가 인프라를 적용할 때 사용하는 역할이다.
_Avoid_: 배포 역할

**배포 역할**:
서비스의 GitHub 저장소에서 실행되는 GitHub Actions가 서비스를 배포할 때 사용하는 역할이다.
_Avoid_: CI 역할
