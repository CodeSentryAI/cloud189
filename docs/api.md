cloud189-sdk package
Classes
Class

Description

CloudAuthClient

CloudClient

天翼网盘客户端

FileTokenStore

MemoryStore

Abstract Classes
Abstract Class

Description

Store

Enumerations
Enumeration

Description

MediaType

文件类型

OrderByType

排序类型

QRCodeStatus

QR code scan status enum

Interfaces
Interface

Description

AccessTokenResponse

accessToken 结果

CacheQuery

CapacityInfo

容量信息

ClientSession

CommitMultiFamilyUploadRequest

提交家庭上传请求

CommitMultiUploadRequest

提交个人上传请求

ConfigurationOptions

客户端初始化参数

CreateBatchTaskRequest

CreateFamilyBatchTaskRequest

CreateFamilyFolderRequest

创建家庭文件夹

CreateFolderRequest

创建个人文件夹

FamilyListResponse

账户家庭信息

FamilyRequest

家庭请求

FamilyUserSignResponse

家庭签到任务结果

FileItem

文件项详细信息

FileListAO

文件列表数据对象

FileListResponse

文件列表API响应数据结构

FolderItem

文件夹项详细信息

initMultiFamilyUploadRequest

初始化家庭上传请求

initMultiUploadRequest

初始化个人上传请求

MultiUploadUrlsResponse

PageQuery

分页参数

QRCodeData

QR code data returned by getQRCode, used for polling status

QRCodeStatusResponse

QR code status check response

QRLoginOptions

QR code login options

RefreshTokenSession

RenameFamilyFolderRequest

创建家庭文件夹

RenameFolderRequest

创建个人文件夹

RsaKey

RsaKeyResponse

RsaKey响应

TokenSession

accessToken 有效期7天，可以通过refreshToken取新的accessToken

UploadCallbacks

UploadCommitResponse

UploadInitResponse

UploadPartsInfoResponse

UploadResponse

UserSignResponse

个人签到结果

UserSizeInfoResponse

账户容量信息

UserTaskResponse

个人任务执行结果

Variables
Variable

Description

logger

日志记录

Type Aliases
Type Alias

Description

PartNumberKey

TaskType


# CloudClient class
天翼网盘客户端

Signature:


export declare class CloudClient 
Constructors
Constructor

Modifiers

Description

(constructor)(_options)

Constructs a new instance of the CloudClient class

Properties
Property

Modifiers

Type

Description

authClient

readonly

CloudAuthClient

password

string

request

readonly

Got

session

readonly

ClientSession

ssonCookie

string

tokenStore

Store

username

string

Methods
Method

Modifiers

Description

checkTaskStatus(type, taskId, maxAttempts, interval)

检测任务状态

checkTransSecond(params)

检测秒传

commitMultiUpload(commitMultiUploadRequest)

提交上传

createBatchTask(createBatchTaskRequest)

创建任务

createFolder(createFolderRequest)

创建文件夹

familyUserSign(familyId)

家庭签到任务

generateRsaKey()

获取 RSA key

getAccessToken()

获取 accessToken

getFamilyList()

获取家庭信息

getFileDownloadUrl(params)

获取文件下载路径

getListFiles(pageQuery, familyId)

获取文件列表

getSession()

getSessionKey()

获取 sessionKey

getUserSizeInfo()

获取用户网盘存储容量信息

initMultiUpload(initMultiUploadRequest)

初始化上传

renameFolder(renameFolderRequest)

重命名文件夹

upload(param, callbacks)

文件上传

userSign()

个人签到任务
