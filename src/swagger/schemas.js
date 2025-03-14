/**
 * @swagger
 * components:
 *   schemas:
 *     Department:
 *       type: object
 *       properties:
 *         _id:
 *           type: string
 *         name:
 *           type: string
 *           description: Tên phòng ban
 *         description:
 *           type: string
 *           description: Mô tả phòng ban
 *         manager:
 *           type: object
 *           properties:
 *             _id:
 *               type: string
 *             fullName:
 *               type: string
 *         isActive:
 *           type: boolean
 *         employeeCount:
 *           type: number
 *         createdAt:
 *           type: string
 *           format: date-time
 *         updatedAt:
 *           type: string
 *           format: date-time
 *       required:
 *         - name
 *
 *     Employee:
 *       type: object
 *       properties:
 *         _id:
 *           type: string
 *         userId:
 *           type: string
 *         fullName:
 *           type: string
 *         dateOfBirth:
 *           type: string
 *           format: date
 *         gender:
 *           type: string
 *           enum: [male, female, other]
 *         address:
 *           type: string
 *         phoneNumber:
 *           type: string
 *         department:
 *           type: string
 *         position:
 *           type: string
 *         salary:
 *           type: number
 *         startDate:
 *           type: string
 *           format: date
 *         avatarUrl:
 *           type: string
 *       required:
 *         - fullName
 *         - dateOfBirth
 *         - gender
 *         - address
 *         - phoneNumber
 *         - department
 *         - position
 *         - salary
 *         - startDate
 *
 *     User:
 *       type: object
 *       properties:
 *         _id:
 *           type: string
 *         email:
 *           type: string
 *           format: email
 *         fullName:
 *           type: string
 *         role:
 *           type: string
 *           enum: [admin, employee]
 *         isActive:
 *           type: boolean
 *         createdAt:
 *           type: string
 *           format: date-time
 *         updatedAt:
 *           type: string
 *           format: date-time
 *       required:
 *         - email
 *         - fullName
 *         - role
 *
 *     AuthResponse:
 *       type: object
 *       properties:
 *         user:
 *           $ref: '#/components/schemas/User'
 *         token:
 *           type: string
 *           description: JWT token
 *
 *     Error:
 *       type: object
 *       properties:
 *         message:
 *           type: string
 *           description: Thông báo lỗi
 *
 *   securitySchemes:
 *     bearerAuth:
 *       type: http
 *       scheme: bearer
 *       bearerFormat: JWT
 */ 